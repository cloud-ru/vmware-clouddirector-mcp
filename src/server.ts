#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { console } from 'inspector';
import { parseStringPromise } from 'xml2js';

interface VcdConfig {
  baseUrl: string;
  username: string;
  password: string;
  org: string;
  apiVersion: string;
}

interface ToolArguments {
  orgId?: string;
  vdcId?: string;
  vappId?: string;
  vmId?: string;
  status?: string;
  name?: string;
  vdcName?: string;
  hours?: number;
  action?: 'powerOn' | 'powerOff' | 'reset' | 'suspend' | 'resume';
  cpuCount?: number;
  memoryMB?: number;
  snapshotName?: string;
  snapshotDescription?: string;
  snapshotId?: string;
  newVmName?: string;
  diskSizeMB?: number;
  diskName?: string;
  diskId?: string;
  networkName?: string;
  networkType?: string;
  catalogName?: string;
  templateName?: string;
  metricType?: string;
  gateway?: string;
  prefixLength?: number;
  endAddress?: string;
  startAddress?: string;
  dnsServer1?: string;
  dnsServer2?: string;
  dnsSuffix?: string;
  diskBusNumber?: string;
  diskUnitNumber?: string;
  newVappName?: string;
}

interface VcdSession {
  token: string;
  expires: Date;
}

function getUrn(str: string) {
  if (str.startsWith('vm-')) {
    return `urn:vcloud:vm:${str.slice(3)}`;
  } else if (str.startsWith('vapp-')) {
    return `urn:vcloud:vapp:${str.slice(3)}`;
  }
  return `urn:vcloud:vdc:${str}`;
}

class VmwareCloudDirectorMCPServer {
  private server: Server;
  private vcdClient: AxiosInstance;
  private session: VcdSession | null = null;
  private config: VcdConfig;

  constructor() {
    this.server = new Server(
      {
        name: 'vmware-cloud-director',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Load configuration from environment variables
    this.config = {
      baseUrl: process.env.VCD_BASE_URL || '',
      username: process.env.VCD_USERNAME || '',
      password: process.env.VCD_PASSWORD || '',
      org: process.env.VCD_ORG || '',
      apiVersion: process.env.VCD_API_VERSION || '37.2',
    };

    // Create axios instance with SSL configuration
    this.vcdClient = axios.create({
      baseURL: this.config.baseUrl,
      timeout: 30000,
      httpsAgent: new https.Agent({
        rejectUnauthorized: false, // Set to true in production with valid certs
      }),
      headers: {
        'Accept': `application/json;version=${this.config.apiVersion}`,
        'Content-Type': 'application/json',
      },
    });

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'vcd_login',
            description: 'Authenticate with VMware Cloud Director',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'list_orgs',
            description: 'List all organizations',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'list_vdcs',
            description: 'List virtual data centers for the organization',
            inputSchema: {
              type: 'object',
              properties: {
                orgId: {
                  type: 'string',
                  description: 'Organization ID (optional, uses configured org if not provided)',
                },
              },
            },
          },
          {
            name: 'get_vdc_details',
            description: 'Get detailed information about a virtual data center including resource allocations',
            inputSchema: {
              type: 'object',
              properties: {
                vdcId: {
                  type: 'string',
                  description: 'Virtual Data Center ID',
                },
              },
              required: ['vdcId'],
            },
          },
          {
            name: 'list_vapps',
            description: 'List vApps in a virtual data center',
            inputSchema: {
              type: 'object',
              properties: {
                vdcId: {
                  type: 'string',
                  description: 'Virtual Data Center ID',
                },
              },
              required: ['vdcId'],
            },
          },
          {
            name: 'list_vms',
            description: 'List virtual machines (optionally filter by vApp ID)',
            inputSchema: {
              type: 'object',
              properties: {
                vappId: {
                  type: 'string',
                  description: 'vApp ID (optional - shows all VMs if not provided)',
                },
                status: {
                  type: 'string',
                  description: 'VM status filter (optional): POWERED_ON, POWERED_OFF, SUSPENDED',
                },
              },
            },
          },
          {
            name: 'search_vms',
            description: 'Search for virtual machines by name or VDC',
            inputSchema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'VM name to search for (optional)',
                },
                vdcName: {
                  type: 'string',
                  description: 'VDC name to search in (optional)',
                },
              },
            },
          },
          {
            name: 'get_vm_details',
            description: 'Get detailed information about a virtual machine',
            inputSchema: {
              type: 'object',
              properties: {
                vmname: {
                  type: 'string',
                  description: 'Virtual Machine Name',
                },
              },
              required: ['name'],
            },
          },
          {
            name: 'get_vm_details_with_id',
            description: 'Get detailed information about a virtual machine with ID',
            inputSchema: {
              type: 'object',
              properties: {
                vmId: {
                  type: 'string',
                  description: 'Virtual Machine ID',
                },
              },
              required: ['vmId'],
            },
          },
          {
            name: 'vm_power_action',
            description: 'Perform power actions on a virtual machine (start, stop, restart, suspend)',
            inputSchema: {
              type: 'object',
              properties: {
                vmId: {
                  type: 'string',
                  description: 'Virtual Machine ID',
                },
                action: {
                  type: 'string',
                  enum: ['powerOn', 'powerOff', 'reset', 'suspend', 'resume'],
                  description: 'Power action to perform',
                },
              },
              required: ['vmId', 'action'],
            },
          },
          {
            name: 'vapp_power_action',
            description: 'Perform power actions on a vApp (start, stop, restart, suspend)',
            inputSchema: {
              type: 'object',
              properties: {
                vappId: {
                  type: 'string',
                  description: 'vApp ID',
                },
                action: {
                  type: 'string',
                  enum: ['powerOn', 'powerOff', 'reset', 'suspend', 'resume'],
                  description: 'Power action to perform',
                },
              },
              required: ['vappId', 'action'],
            },
          },
          {
            name: 'list_networks',
            description: 'List organization networks',
            inputSchema: {
              type: 'object',
              properties: {
                orgId: {
                  type: 'string',
                  description: 'Organization ID (optional, uses configured org if not provided)',
                },
              },
            },
          },
          {
            name: 'get_resource_usage',
            description: 'Get resource usage statistics for the organization',
            inputSchema: {
              type: 'object',
              properties: {
                orgId: {
                  type: 'string',
                  description: 'Organization ID (optional, uses configured org if not provided)',
                },
              },
            },
          },
          {
            name: 'list_firewall_rules',
            description: 'List firewall rules for a VDC edge gateway',
            inputSchema: {
              type: 'object',
              properties: {
                vdcId: {
                  type: 'string',
                  description: 'Virtual Data Center ID',
                },
              },
              required: ['vdcId'],
            },
          },
          {
            name: 'list_tasks',
            description: 'List recent tasks for the organization',
            inputSchema: {
              type: 'object',
              properties: {
                hours: {
                  type: 'number',
                  description: 'Number of hours to look back (default: 24)',
                },
              },
            },
          },
          // VM Management Functions
          {
            name: 'vm_configure',
            description: 'Modify VM specifications (CPU, memory)',
            inputSchema: {
              type: 'object',
              properties: {
                vmId: { type: 'string', description: 'Virtual Machine ID' },
                cpuCount: { type: 'number', description: 'Number of CPUs (optional)' },
                memoryMB: { type: 'number', description: 'Memory in MB (optional)' },
              },
              required: ['vmId'],
            },
          },
          {
            name: 'vm_create_snapshot',
            description: 'Create a VM snapshot',
            inputSchema: {
              type: 'object',
              properties: {
                vmId: { type: 'string', description: 'Virtual Machine ID' },
                snapshotName: { type: 'string', description: 'Snapshot name' },
              },
              required: ['vmId', 'snapshotName'],
            },
          },
          {
            name: 'vm_list_snapshots',
            description: 'List VM snapshots',
            inputSchema: {
              type: 'object',
              properties: {
                vmId: { type: 'string', description: 'Virtual Machine ID' },
              },
              required: ['vmId'],
            },
          },
          {
            name: 'vm_restore_snapshot',
            description: 'Restore VM from snapshot',
            inputSchema: {
              type: 'object',
              properties: {
                vmId: { type: 'string', description: 'Virtual Machine ID' },
                snapshotId: { type: 'string', description: 'Snapshot ID' },
              },
              required: ['vmId', 'snapshotId'],
            },
          },
          {
            name: 'vapp_clone',
            description: 'Clone a vApp',
            inputSchema: {
              type: 'object',
              properties: {
                vappId: { type: 'string', description: 'Source vApp ID' },
                vdcId: { type: 'string', description: 'Target VDC ID' },
                newVappName: { type: 'string', description: 'Target vApp name (optional)' },
              },
              required: ['vappId', 'vdcId'],
            },
          },
          // Storage Management Functions
          {
            name: 'list_datastores',
            description: 'List available datastores in the organization',
            inputSchema: {
              type: 'object',
              properties: {
                vdcId: { type: 'string', description: 'VDC ID (optional)' },
              },
            },
          },
          {
            name: 'vm_add_disk',
            description: 'Add a new disk to a VM',
            inputSchema: {
              type: 'object',
              properties: {
                vmId: { type: 'string', description: 'Virtual Machine ID' },
                diskSizeMB: { type: 'number', description: 'Disk size in MB' },
                diskName: { type: 'string', description: 'Disk name (optional)' },
              },
              required: ['vmId', 'diskSizeMB'],
            },
          },
          {
            name: 'vm_list_disks',
            description: 'List VM disks',
            inputSchema: {
              type: 'object',
              properties: {
                vmId: { type: 'string', description: 'Virtual Machine ID' },
              },
              required: ['vmId'],
            },
          },
          {
            name: 'vm_resize_disk',
            description: 'Resize VM disk',
            inputSchema: {
              type: 'object',
              properties: {
                vmId: { type: 'string', description: 'Virtual Machine ID' },
                diskBusNumber: { type: 'string', description: 'Disk Bus Number' },
                diskUnitNumber: { type: 'string', description: 'Disk Unit Number' },
                diskSizeMB: { type: 'number', description: 'New disk size in MB' },
              },
              required: ['vmId', 'diskBusNumber', 'diskUnitNumber','diskSizeMB'],
            },
          },
          // Networking Functions
          {
            name: 'create_org_network',
            description: 'Create organization network',
            inputSchema: {
              type: 'object',
              properties: {
                networkName: { type: 'string', description: 'Network name' },
                networkType: { type: 'string', enum: ['isolated', 'routed'], description: 'Network type' },
                vdcId: { type: 'string', description: 'VDC ID' },
                gateway: { type: 'string', description: 'Gateway IP-address' },
                startAddress: { type: 'string', description: 'Network range start IP-address' },
                endAddress: { type: 'string', description: 'Network range end IP-address' },
                prefixLength: { type: 'number', description: 'Network mask' },
                dnsServer1: { type: 'string', description: 'DNS1 IP-address (optional, default=null)' },
                dnsServer2: { type: 'string', description: 'DNS2 IP-address (optional, default=null)' },
                dnsSuffix: { type: 'string', description: 'DNS suffix (optional, default=domain.local)' },
              },
              required: ['networkName', 'networkType', 'vdcId', 'gateway', 'startAddress', 'endAddress', 'prefixLength'],
            },
          },
          {
            name: 'list_nat_rules',
            description: 'List NAT rules for VDC edge gateway',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'list_dhcp_pools',
            description: 'List DHCP pools for VDC edge gateway',
            inputSchema: {
              type: 'object',
              properties: {
                vdcId: { type: 'string', description: 'VDC ID' },
              },
              required: ['vdcId'],
            },
          },
          {
            name: 'list_ip_allocations',
            description: 'List IP address allocations',
            inputSchema: {
              type: 'object',
              properties: {
                vdcId: { type: 'string', description: 'VDC ID' },
              },
              required: ['vdcId'],
            },
          },
          // Templates & Catalogs Functions
          {
            name: 'list_catalogs',
            description: 'List organization catalogs',
            inputSchema: {
              type: 'object',
              properties: {
                orgId: { type: 'string', description: 'Organization ID (optional)' },
              },
            },
          },
          {
            name: 'list_catalog_items',
            description: 'List items in a catalog',
            inputSchema: {
              type: 'object',
              properties: {
                catalogName: { type: 'string', description: 'Catalog name' },
              },
              required: ['catalogName'],
            },
          },
          {
            name: 'get_template_details',
            description: 'Get VM template details',
            inputSchema: {
              type: 'object',
              properties: {
                templateName: { type: 'string', description: 'Template name' },
              },
              required: ['templateName'],
            },
          },
          // Monitoring & Alerts Functions
          {
            name: 'get_vm_metrics',
            description: 'Get VM performance metrics',
            inputSchema: {
              type: 'object',
              properties: {
                vmId: { type: 'string', description: 'Virtual Machine ID' },
              },
              required: ['vmId'],
            },
          },
          {
            name: 'list_events',
            description: 'List system events and alerts',
            inputSchema: {
              type: 'object',
              properties: {
                hours: { type: 'number', description: 'Hours to look back (default: 24)' },
              },
            },
          },
          {
            name: 'get_org_health',
            description: 'Get organization health status',
            inputSchema: {
              type: 'object',
              properties: {
                orgId: { type: 'string', description: 'Organization ID (optional)' },
              },
            },
          },
          {
            name: 'get_resource_metrics',
            description: 'Get resource utilization metrics',
            inputSchema: {
              type: 'object',
              properties: {
                vdcId: { type: 'string', description: 'VDC ID (optional)' },
              },
            },
          },
          {
            name: 'health_check',
            description: 'Check VMware Cloud Director connection status',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const typedArgs = args as ToolArguments;

      try {
        switch (name) {
          case 'vcd_login':
            return await this.handleLogin();
          
          case 'list_orgs':
            return await this.handleListOrgs();
          
          case 'list_vdcs':
            return await this.handleListVdcs(typedArgs?.orgId);
          
          case 'get_vdc_details':
            return await this.handleGetVdcDetails(typedArgs?.vdcId);
          
          case 'list_vapps':
            return await this.handleListVapps(typedArgs?.vdcId);
          
          case 'list_vms':
            return await this.handleListVms(typedArgs?.vappId, typedArgs?.status);
          
          case 'search_vms':
            return await this.handleSearchVms(typedArgs?.name, typedArgs?.vdcName);
          
          case 'get_vm_details':
            return await this.handleGetVmDetails(typedArgs?.name);
          
          case 'get_vm_details_with_id':
            return await this.handleGetVmDetailsWithVmId(typedArgs?.vmId);

          case 'vm_power_action':
            return await this.handleVmPowerAction(typedArgs?.vmId, typedArgs?.action);
          
          case 'vapp_power_action':
            return await this.handleVappPowerAction(typedArgs?.vappId, typedArgs?.action);
          
          case 'list_networks':
            return await this.handleListNetworks(typedArgs?.orgId);
          
          case 'get_resource_usage':
            return await this.handleGetResourceUsage(typedArgs?.orgId);
          
          case 'list_firewall_rules':
            return await this.handleListFirewallRules(typedArgs?.vdcId);
          
          case 'list_tasks':
            return await this.handleListTasks(typedArgs?.hours);
          
          // VM Management Cases
          case 'vm_configure':
            return await this.handleVmConfigure(typedArgs?.vmId, typedArgs?.cpuCount, typedArgs?.memoryMB);
          
          case 'vm_create_snapshot':
            return await this.handleVmCreateSnapshot(typedArgs?.vmId, typedArgs?.snapshotName);
          
          case 'vm_list_snapshots':
            return await this.handleVmListSnapshots(typedArgs?.vmId);
          
          case 'vm_restore_snapshot':
            return await this.handleVmRestoreSnapshot(typedArgs?.vmId, typedArgs?.snapshotId);
          
          case 'vapp_clone':
            return await this.handleVappClone(typedArgs?.vappId, typedArgs?.vdcId, typedArgs?.newVappName);

            // Storage Management Cases
          case 'list_datastores':
            return await this.handleListDatastores(typedArgs?.vdcId);
          
          case 'vm_add_disk':
            return await this.handleVmAddDisk(typedArgs?.vmId, typedArgs?.diskSizeMB, typedArgs?.diskName);
          
          case 'vm_list_disks':
            return await this.handleVmListDisks(typedArgs?.vmId);
          
          case 'vm_resize_disk':
            return await this.handleVmResizeDisk(typedArgs?.vmId, typedArgs?.diskBusNumber, typedArgs?.diskUnitNumber, typedArgs?.diskSizeMB);
          
          // Networking Cases
          case 'create_org_network':
            return await this.handleCreateOrgNetwork(typedArgs?.networkName, typedArgs?.networkType, typedArgs?.vdcId, typedArgs?.gateway, typedArgs?.startAddress, typedArgs?.endAddress, typedArgs?.prefixLength, typedArgs?.dnsServer1, typedArgs?.dnsServer2, typedArgs?.dnsSuffix);
          
          case 'list_nat_rules':
            return await this.handleListNatRules();
          
          case 'list_dhcp_pools':
            return await this.handleListDhcpPools(typedArgs?.vdcId);
          
          case 'list_ip_allocations':
            return await this.handleListIpAllocations(typedArgs?.vdcId);
          
          // Templates & Catalogs Cases
          case 'list_catalogs':
            return await this.handleListCatalogs(typedArgs?.orgId);
          
          case 'list_catalog_items':
            return await this.handleListCatalogItems(typedArgs?.catalogName);
          
          case 'get_template_details':
            return await this.handleGetTemplateDetails(typedArgs?.templateName);
          
          // Monitoring & Alerts Cases
          case 'get_vm_metrics':
            return await this.handleGetVmMetrics(typedArgs?.vmId);
          
          case 'list_events':
            return await this.handleListEvents(typedArgs?.hours);
          
          case 'get_org_health':
            return await this.handleGetOrgHealth(typedArgs?.orgId);
          
          case 'get_resource_metrics':
            return await this.handleGetResourceMetrics(typedArgs?.vdcId);
          
          case 'health_check':
            try {
              await this.ensureAuthenticated();
              return {
                content: [{
                  type: 'text',
                  text: `✅ VMware Cloud Director connection: OK\n📊 Connected to: ${this.config.baseUrl}\n🏢 Organization: ${this.config.org}\n📅 Session expires: ${this.session?.expires}`
                }]
              };
            } catch (error) {
              return {
                content: [{
                  type: 'text',
                  text: `❌ Health check failed: ${error instanceof Error ? error.message : String(error)}`
                }]
              };
            }
          
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.session || this.session.expires <= new Date()) {
      await this.authenticate();
    }
  }

  private async authenticate(): Promise<void> {
    try {
      const params = new URLSearchParams();
      params.append('grant_type', 'refresh_token');
      params.append('refresh_token', `${this.config.password}`);

      const response = await this.vcdClient.post(`/oauth/tenant/${this.config.org}/token`, params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const accessToken = response.data.access_token;

      this.session = {
        token: accessToken,
        expires: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
      };

      // Set the authorization header for future requests
      this.vcdClient.defaults.headers.common['Authorization'] = `Bearer ${this.session.token}`;
    } catch (error) {
      throw new Error(`API token authentication failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

//   private async authenticate(): Promise<void> {
//     try {
//       const credentials = Buffer.from(`${this.config.username}@${this.config.org}:${this.config.password}`).toString('base64');
//
//       const response = await this.vcdClient.post('/cloudapi/1.0.0/sessions', null, {
//         headers: {
//           'Authorization': `Basic ${credentials}`
//         }
//       });
//
//       this.session = {
//         token: response.headers['x-vmware-vcloud-access-token'],
//         expires: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
//       };
//
//       // Set the authorization header for future requests
//       this.vcdClient.defaults.headers.common['Authorization'] = `Bearer ${this.session.token}`;
//     } catch (error) {
//       throw new Error(`Authentication failed: ${error instanceof Error ? error.message : String(error)}`);
//     }
//   }

  private async handleLogin() {
    await this.authenticate();
    return {
      content: [
        {
          type: 'text',
          text: 'Successfully authenticated with VMware Cloud Director',
        },
      ],
    };
  }

  private async handleListOrgs() {
    await this.ensureAuthenticated();
    
    try {
      const response = await this.vcdClient.get('/cloudapi/1.0.0/orgs');
      const orgs = response.data.values || [];
      
      return {
        content: [
          {
            type: 'text',
            text: `Found ${orgs.length} organizations:\n${orgs.map((org: any) => 
              `- ${org.name} (ID: ${org.id})`
            ).join('\n')}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to list organizations: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleListVdcs(orgId?: string) {
    await this.ensureAuthenticated();
    
    try {
      const response = await this.vcdClient.get('/cloudapi/1.0.0/vdcs');
      const vdcs = response.data.values || [];
      
      return {
        content: [
          {
            type: 'text',
            text: `Found ${vdcs.length} virtual data centers:\n${vdcs.map((vdc: any) => 
              `- ${vdc.name} (ID: ${vdc.id})`
            ).join('\n')}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to list VDCs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleGetVdcDetails(vdcId?: string) {
    await this.ensureAuthenticated();
    
    try {
      if (!vdcId) throw new Error('VDC ID is required');
      
      // Get basic VDC info
      const vdcResponse = await this.vcdClient.get(`/cloudapi/1.0.0/vdcs/${vdcId}`);
      const vdc = vdcResponse.data;
      
      // Get VDC capabilities
      let capabilities = [];
      try {
        const capResponse = await this.vcdClient.get(`/cloudapi/1.0.0/vdcs/${vdcId}/capabilities`);
        capabilities = capResponse.data.values || [];
      } catch (capError) {
        // Capabilities might not be available
      }
      
      // Build capabilities summary
      const networkProvider = capabilities.find((cap: any) => cap.name === 'networkProvider')?.value || 'Unknown';
      const supportedVdcGroups = capabilities.find((cap: any) => cap.name === 'vdcGroupTypes')?.value || [];
      const supportedNetworkProviders = capabilities.find((cap: any) => cap.name === 'vdcGroupNetworkProviderTypes')?.value || [];
      
      // Key capabilities
      const keyCapabilities = [
        'edgeLoadBalancer', 'edgeIpSecVpn', 'edgeBgpRouting', 'edgeStaticRoutes',
        'orgVdcRouted', 'orgVdcIsolated', 'dualStackNetworking', 'guestVlanTagging'
      ];
      
      const supportedFeatures = keyCapabilities
        .filter(capName => capabilities.find((cap: any) => cap.name === capName)?.value === true)
        .join(', ');
      
      return {
        content: [
          {
            type: 'text',
            text: `VDC Details for ${vdc.name}:\n\n` +
                  `Basic Information:\n` +
                  `- ID: ${vdc.id}\n` +
                  `- Organization: ${vdc.org?.name || 'N/A'}\n` +
                  `- Allocation Type: ${vdc.allocationType || 'N/A'}\n` +
                  `- Description: ${vdc.description || 'None'}\n\n` +
                  `Network Configuration:\n` +
                  `- Network Provider: ${networkProvider}\n` +
                  `- Networking Tenancy: ${vdc.networkingTenancyEnabled ? 'Enabled' : 'Disabled'}\n` +
                  `- vApp Network Standby: ${vdc.vappNetworkStandbyEnabled ? 'Enabled' : 'Disabled'}\n` +
                  `- vApp NAT Type Reflexive: ${vdc.vappNatTypeReflexiveEnabled ? 'Enabled' : 'Disabled'}\n\n` +
                  `VDC Group Support:\n` +
                  `- Supported VDC Group Types: ${supportedVdcGroups.join(', ') || 'None'}\n` +
                  `- Supported Network Providers: ${supportedNetworkProviders.join(', ') || 'None'}\n\n` +
                  `Key Features Supported:\n` +
                  `${supportedFeatures || 'None listed'}\n\n` +
                  `Total Capabilities: ${capabilities.length} features available`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get VDC details: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleListVapps(vdcId?: string) {
    await this.ensureAuthenticated();
    
    try {
      let url = '/api/query?type=vApp';
      if (vdcId) {
        url += `&filter=vdc==${vdcId}`;
      }
      const response = await this.vcdClient.get(url, {
        headers: {
          'Accept': `application/*+xml;version=${this.config.apiVersion}`,
          'Authorization': `Bearer ${this.session?.token}`
        }
      });
      
      // Parse XML response if it's a string
      let vapps = [];
      if (typeof response.data === 'string') {
        try {
          const parsed = await parseStringPromise(response.data);
          if (parsed.QueryResultRecords && parsed.QueryResultRecords.VAppRecord) {
            vapps = parsed.QueryResultRecords.VAppRecord.map((record: any) => ({
              name: record.$.name,
              status: record.$.status,
              href: record.$.href,
              vdcName: record.$.vdcName,
              id: record.$.href?.split('/').pop(),
              numberOfVMs: record.$.numberOfVMs,
              numberOfCpus: record.$.numberOfCpus,
              memoryAllocationMB: record.$.memoryAllocationMB,
              creationDate: record.$.creationDate,
              description: record.$.description
            }));
          }
        } catch (xmlError) {
          console.error('Failed to parse XML response:', xmlError);
        }
      } else if (response.data.record) {
        vapps = response.data.record;
      } else if (Array.isArray(response.data)) {
        vapps = response.data;
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Found ${vapps.length} vApps:\n${vapps.map((vapp: any) => 
              `- ${vapp.name} (Status: ${vapp.status}, ID: ${vapp.href?.split('/').pop()})`
            ).join('\n')}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to list vApps: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleListVms(vappId?: string, status?: string) {
    await this.ensureAuthenticated();
    
    try {
      const allVms: any[] = [];
      const searchResults: string[] = [];
      
      // Try multiple query types to find all VMs including standalone ones
      const queryType = { type: 'vm', description: 'Standard VM query' };
      
        try {
          let url = `/api/query?type=${queryType.type}`;
          
          const response = await this.vcdClient.get(url, {
            headers: {
              'Accept': `application/*+xml;version=${this.config.apiVersion}`,
              'Authorization': `Bearer ${this.session?.token}`
            }
          });
          
          let items = [];
          if (typeof response.data === 'string') {
            try {
              const parsed = await parseStringPromise(response.data);
              items = parsed.QueryResultRecords.VMRecord.map((record: any) => ({
                name: record.$.name,
                status: record.$.status,
                href: record.$.href,
                vdcName: record.$.vdcName,
                vdcId: record.$.vdc?.split('/').pop(),
                id: record.$.href?.split('/').pop(),
                numOfSnapshots: record.$.numOfSnapshots,
                container: record.$.container?.split('/').pop(),
                containerName: record.$.containerName,
                numberOfCpus: record.$.numberOfCpus,
                memoryMB: record.$.memoryMB,
                totalStorageAllocatedMb: record.$.totalStorageAllocatedMb,
                dateCreated: record.$.dateCreated,
                description: record.$.description,
                isVAppTemplate: record.$.isVAppTemplate
            }));
            } catch (xmlError) {
              console.error('Failed to parse XML response:', xmlError);
              items = [];
            }
          } else if (response.data.record) {
            items = response.data.record;
          } else if (Array.isArray(response.data)) {
            items = response.data;
          }

          searchResults.push(`${queryType.description}: ${items.length} items`);
          
          // Filter by vApp and status if specified
           const filteredVms = items.filter((vm: any) => {
            const vappMatch = !vappId || vm.container === vappId || vm.containerName?.includes(vappId);
            const statusMatch = !status || vm.status === status;
            return vappMatch && statusMatch;
          });
          allVms.push(...filteredVms);
 
        } catch (queryError) {
          searchResults.push(`${queryType.description}: Failed (${(queryError as any).response?.status || 'error'})`);
        }
      
      let statusText = status ? ` with status ${status}` : '';
      let vappText = vappId ? ` in vApp ${vappId}` : '';
      
      const vmList = allVms.map((vm: any) => 
        `- ${vm.name} (Status: ${vm.status}, CPU: ${vm.numberOfCpus || vm.cpuCount || 'N/A'}, Memory: ${vm.memoryMB || 'N/A'}MB, VDC: ${vm.vdcName || vm.vdc?.name || 'N/A'}, Container: ${vm.containerName || vm.vapp?.name || 'Standalone'}, ID: ${vm.id || vm.href?.split('/').pop()})`
      ).join('\n');
      
      return {
        content: [
          {
            type: 'text',
            text: `VM Search Results${vappText}${statusText}:\n\n` +
                  `Found ${allVms.length} virtual machines:\n${vmList || '(none)'}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to list VMs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleSearchVms(name?: string, vdcName?: string) {
    await this.ensureAuthenticated();
    
    try {
      const allVms: any[] = [];
      const searchResults: string[] = [];
      
      // Try multiple query types to find all VMs including standalone ones
      const queryType = { type: 'vm', description: 'Standard VM query' };
      
      try {
        let url = `/api/query?type=${queryType.type}`;
        const response = await this.vcdClient.get(url, {
          headers: {
            'Accept': `application/*+xml;version=${this.config.apiVersion}`,
            'Authorization': `Bearer ${this.session?.token}`
          }
        });
        
        let items = [];
        if (typeof response.data === 'string') {
          try {
            const parsed = await parseStringPromise(response.data);
            items = parsed.QueryResultRecords.VMRecord.map((record: any) => ({
              name: record.$.name,
              status: record.$.status,
              href: record.$.href,
              vdcName: record.$.vdcName,
              vdcId: record.$.vdc?.split('/').pop(),
              id: record.$.href?.split('/').pop(),
              numOfSnapshots: record.$.numOfSnapshots,
              container: record.$.container?.split('/').pop(),
              containerName: record.$.containerName,
              numberOfCpus: record.$.numberOfCpus,
              memoryMB: record.$.memoryMB,
              totalStorageAllocatedMb: record.$.totalStorageAllocatedMb,
              dateCreated: record.$.dateCreated,
              description: record.$.description,
              isVAppTemplate: record.$.isVAppTemplate
          }));
          } catch (xmlError) {
            console.error('Failed to parse XML response:', xmlError);
            items = [];
          }
        } else if (response.data.record) {
          items = response.data.record;
        } else if (Array.isArray(response.data)) {
          items = response.data;
        }
        searchResults.push(`${queryType.description}: ${items.length} items`);
        
        // Filter by name and VDC if specified
        const filteredVms = items.filter((vm: any) => {
          const nameMatch = !name || vm.name?.toLowerCase().includes(name.toLowerCase());
          const vdcMatch = !vdcName || vm.vdcName?.toLowerCase().includes(vdcName.toLowerCase());
          return nameMatch && vdcMatch;
        });
        allVms.push(...filteredVms);

      } catch (queryError) {
        searchResults.push(`${queryType.description}: Failed (${(queryError as any).response?.status || 'error'})`);
      }
      
      let searchText = '';
      if (name && vdcName) {
        searchText = ` named "${name}" in VDC "${vdcName}"`;
      } else if (name) {
        searchText = ` named "${name}"`;
      } else if (vdcName) {
        searchText = ` in VDC "${vdcName}"`;
      }
      
      const vmList = allVms.map((vm: any) => 
        `- ${vm.name} (Status: ${vm.status}, CPU: ${vm.numberOfCpus || vm.cpuCount || 'N/A'}, Memory: ${vm.memoryMB || 'N/A'}MB, VDC: ${vm.vdcName || vm.vdc?.name || 'N/A'}, Container: ${vm.containerName || vm.vapp?.name || 'Standalone'}, ID: ${vm.href?.split('/').pop() || vm.id})`
      ).join('\n');
      
      return {
        content: [
          {
            type: 'text',
            text: `Search Results${searchText}:\n\n` +
                  `Found ${allVms.length} virtual machines:\n${vmList || '(none)'}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to search VMs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleGetVmDetails(name?: string) {
    await this.ensureAuthenticated();
    
    try {
      if (!name) throw new Error('VM name is required');
      let url = `/api/query?type=vm&format=records&filter=(name==**${name}**)`;
      const response = await this.vcdClient.get(url, {
        headers: {
          'Accept': `application/*+xml;version=${this.config.apiVersion}`,
          'Authorization': `Bearer ${this.session?.token}`
        }
      });
      let vm = null;
      if (typeof response.data === 'string') {
        try {
          const parsed = await parseStringPromise(response.data);
          const record = Array.isArray(parsed.QueryResultRecords.VMRecord)
            ? parsed.QueryResultRecords.VMRecord[0]
            : parsed.QueryResultRecords.VMRecord;

          vm = {
            name: record.$.name,
            status: record.$.status,
            href: record.$.href,
            vdcName: record.$.vdcName,
            vdcId: record.$.vdc?.split('/').pop(),
            id: record.$.href?.split('/').pop(),
            numOfSnapshots: record.$.numOfSnapshots,
            container: record.$.container?.split('/').pop(),
            containerName: record.$.containerName,
            numberOfCpus: record.$.numberOfCpus,
            memoryMB: record.$.memoryMB,
            totalStorageAllocatedMb: record.$.totalStorageAllocatedMb,
            dateCreated: record.$.dateCreated,
            description: record.$.description,
            isVAppTemplate: record.$.isVAppTemplate
          };
        } catch (xmlError) {
          console.error('Failed to parse XML response:', xmlError);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(vm, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get VM details: ${error instanceof Error ? error.message : String(error)}`);
    }

  }

  private async handleGetVmDetailsWithVmId(vmId?: string) {
    await this.ensureAuthenticated();

    try {
      if (!vmId) throw new Error('VM ID is required');

      const url = `/api/query?type=vm`;
      const response = await this.vcdClient.get(url, {
        headers: {
          'Accept': `application/*+xml;version=${this.config.apiVersion}`,
          'Authorization': `Bearer ${this.session?.token}`
        }
      });

      let vm = null;
      if (typeof response.data === 'string') {
        try {
          const parsed = await parseStringPromise(response.data);
          const records = parsed.QueryResultRecords?.VMRecord || [];

          const record = Array.isArray(records)
            ? records.find((r: any) => r.$.href?.split('/').pop() === vmId)
            : records;

          if (!record) {
            throw new Error(`VM with ID ${vmId} not found`);
          }

          vm = {
            name: record.$.name,
            status: record.$.status,
            href: record.$.href,
            vdcName: record.$.vdcName,
            vdcId: record.$.vdc?.split('/').pop(),
            id: record.$.href?.split('/').pop(),
            numOfSnapshots: record.$.numOfSnapshots,
            container: record.$.container?.split('/').pop(),
            containerName: record.$.containerName,
            numberOfCpus: record.$.numberOfCpus,
            memoryMB: record.$.memoryMB,
            totalStorageAllocatedMb: record.$.totalStorageAllocatedMb,
            dateCreated: record.$.dateCreated,
            description: record.$.description,
            isVAppTemplate: record.$.isVAppTemplate,
            storageProfileName: record.$.storageProfileName
          };
        } catch (xmlError) {
          console.error('Failed to parse XML response:', xmlError);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(vm, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get VM details: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleVmPowerAction(vmId?: string, action?: string) {
    await this.ensureAuthenticated();
    if (!vmId) throw new Error('VM ID is required');
    if (!action) throw new Error('Action is required');    

    try {
      const response = await this.vcdClient.post(`/api/vApp/${vmId}/power/action/${action}`, null, {
        headers: {
          'Accept': `application/*+xml;version=${this.config.apiVersion}`,
          'Authorization': `Bearer ${this.session?.token}`
        }
      });
      const parsed = await parseStringPromise(response.data, {
        explicitCharkey: true,
        attrkey: '@attrs'
      });
      return {
        content: [
          {
            type: 'text',
            text: `Power action '${action}' initiated for VM ${vmId}. Task ID: ${parsed.Task['@attrs'].id}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to perform power action: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleVappPowerAction(vappId?: string, action?: string) {
    await this.ensureAuthenticated();
    
    try {
      if (!vappId) throw new Error('vApp ID is required');
      if (!action) throw new Error('Action is required');
      
      // Use legacy API with correct endpoint
      const response = await this.vcdClient.post(`/api/vApp/${vappId}/power/action/${action}`, null, {
        headers: {
          'Accept': `application/*+xml;version=${this.config.apiVersion}`,
          'Authorization': `Bearer ${this.session?.token}`
        }
      });
      
      let taskId = 'N/A';
      let operation = 'Unknown';
      
      if (typeof response.data === 'string') {
        // Parse XML response to get task details
        try {
          const parsed = await parseStringPromise(response.data);
          if (parsed.Task && parsed.Task.$) {
            taskId = parsed.Task.$.id || parsed.Task.$.href?.split('/').pop() || 'N/A';
            operation = parsed.Task.$.operation || 'Unknown operation';
          }
        } catch (xmlError) {
          // Ignore XML parsing errors for task ID
        }
      } else if (response.data.id) {
        taskId = response.data.id;
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Power action '${action}' initiated for vApp ${vappId}.\nOperation: ${operation}\nTask ID: ${taskId}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to perform vApp power action: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleListNetworks(orgId?: string) {
    await this.ensureAuthenticated();
    
    try {
      // Use CloudAPI 1.0.0 for org VDC networks (which works)
      const response = await this.vcdClient.get('/cloudapi/1.0.0/orgVdcNetworks');
      const networks = response.data.values || [];
      
      return {
        content: [
          {
            type: 'text',
            text: `Found ${networks.length} organization VDC networks:\n${networks.map((network: any, index: number) => 
              `${index + 1}. ${network.name} (Type: ${network.networkType}, VDC: ${network.orgVdc?.name || 'N/A'}, IPs Used: ${network.usedIpCount}/${network.totalIpCount}, Shared: ${network.shared})`
            ).join('\n') || '(none)'}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to list networks: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleGetResourceUsage(orgId?: string) {
    await this.ensureAuthenticated();
    
    try {
      // Use working CloudAPI to get organization details
      const orgResponse = await this.vcdClient.get('/cloudapi/1.0.0/orgs');
      const orgs = orgResponse.data.values || [];
      const org = orgId ? orgs.find((o: any) => o.id === orgId) : orgs[0];
      
      if (!org) {
        throw new Error('Organization not found');
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Resource usage for organization '${org.name}':\n\n` +
                  `Organization Statistics:\n` +
                  `- VDCs: ${org.orgVdcCount || 0}\n` +
                  `- Catalogs: ${org.catalogCount || 0}\n` +
                  `- vApps: ${org.vappCount || 0}\n` +
                  `- Running VMs: ${org.runningVMCount || 0}\n` +
                  `- Users: ${org.userCount || 0}\n` +
                  `- Disks: ${org.diskCount || 0}\n` +
                  `- Enabled: ${org.isEnabled ? 'Yes' : 'No'}\n` +
                  `- Managed Orgs: ${org.directlyManagedOrgCount || 0}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get resource usage: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleListFirewallRules(vdcId?: string) {
    await this.ensureAuthenticated();
    
    try {
      if (!vdcId) throw new Error('VDC ID is required');
      
      const results: string[] = [];
      
      // First, try to find edge gateways in the VDC
      try {
        const edgeGatewaysResponse = await this.vcdClient.get('/cloudapi/1.0.0/edgeGateways', {
          params: {
            filter: `orgVdc.id==${vdcId}`
          }
        });
        
        const edgeGateways = edgeGatewaysResponse.data.values || [];
        results.push(`Found ${edgeGateways.length} edge gateways in VDC`);
        
        if (edgeGateways.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No edge gateways found in VDC ${vdcId}. Cannot retrieve firewall rules without an edge gateway.`,
              },
            ],
          };
        }
        
        // Get firewall rules for each edge gateway
        for (const edgeGateway of edgeGateways) {
          try {
            const firewallResponse = await this.vcdClient.get(`/cloudapi/1.0.0/edgeGateways/${edgeGateway.id}/firewall/rules`);
            const firewallData = firewallResponse.data;
            
            results.push(`\nEdge Gateway: ${edgeGateway.name} (${edgeGateway.id})`);
            results.push(`Status: ${firewallData.status || 'Unknown'}`);
            
            // Process user-defined rules
            const userRules = firewallData.userDefinedRules || [];
            const systemRules = firewallData.systemRules || [];
            const defaultRules = firewallData.defaultRules || [];
            
            const totalRules = userRules.length + systemRules.length + defaultRules.length;
            results.push(`Firewall Rules (${totalRules} total):`);
            
            if (userRules.length > 0) {
              results.push(`\n  User-Defined Rules (${userRules.length}):`);
              userRules.forEach((rule: any, index: number) => {
                results.push(`    ${index + 1}. ${rule.name || 'Unnamed Rule'}`);
                results.push(`       Action: ${rule.action || 'N/A'}`);
                results.push(`       Direction: ${rule.direction || 'N/A'}`);
                results.push(`       Source Groups: ${rule.sourceFirewallGroups?.map((g: any) => g.name).join(', ') || 'Any'}`);
                results.push(`       Source IPs: ${rule.sourceFirewallIpAddresses?.join(', ') || 'Any'}`);
                results.push(`       Destination Groups: ${rule.destinationFirewallGroups?.map((g: any) => g.name).join(', ') || 'Any'}`);
                results.push(`       Destination IPs: ${rule.destinationFirewallIpAddresses?.join(', ') || 'Any'}`);
                results.push(`       Services: ${rule.applicationPortProfiles?.map((p: any) => p.name).join(', ') || 'Any'}`);
                results.push(`       Protocol: ${rule.ipProtocol || 'N/A'}`);
                results.push(`       Enabled: ${rule.enabled ? 'Yes' : 'No'}`);
                results.push(`       Logging: ${rule.logging ? 'Yes' : 'No'}`);
                if (rule.description) results.push(`       Description: ${rule.description}`);
                results.push('');
              });
            }
            
            if (systemRules.length > 0) {
              results.push(`\n  System Rules (${systemRules.length}):`);
              systemRules.forEach((rule: any, index: number) => {
                results.push(`    ${index + 1}. ${rule.name || 'Unnamed Rule'}`);
                results.push(`       Action: ${rule.action || 'N/A'}`);
                results.push(`       Direction: ${rule.direction || 'N/A'}`);
                results.push(`       Enabled: ${rule.enabled ? 'Yes' : 'No'}`);
                results.push('');
              });
            }
            
            if (defaultRules.length > 0) {
              results.push(`\n  Default Rules (${defaultRules.length}):`);
              defaultRules.forEach((rule: any, index: number) => {
                results.push(`    ${index + 1}. ${rule.name || 'Unnamed Rule'}`);
                results.push(`       Action: ${rule.action || 'N/A'}`);
                results.push(`       Direction: ${rule.direction || 'N/A'}`);
                results.push(`       Protocol: ${rule.ipProtocol || 'N/A'}`);
                results.push(`       Enabled: ${rule.enabled ? 'Yes' : 'No'}`);
                if (rule.description) results.push(`       Description: ${rule.description}`);
                results.push('');
              });
            }
            
            if (totalRules === 0) {
              results.push('  No firewall rules configured');
            }
            
          } catch (firewallError) {
            results.push(`  Failed to get firewall rules for ${edgeGateway.name}: ${(firewallError as any).response?.status || 'error'}`);
          }
        }
        
      } catch (edgeError) {
        // Try legacy API approach
        results.push('CloudAPI edge gateway query failed, trying legacy API...');
        
        try {
          const legacyEdgeResponse = await this.vcdClient.get(`/api/query?type=edgeGateway&filter=vdc==${vdcId}`, {
            headers: {
              'Accept': `application/*+xml;version=${this.config.apiVersion}`,
              'Authorization': `Bearer ${this.session?.token}`
            }
          });
          
          const legacyEdges = legacyEdgeResponse.data.record || [];
          results.push(`Legacy API found ${legacyEdges.length} edge gateways`);
          
          if (legacyEdges.length === 0) {
            results.push('No edge gateways found via legacy API either');
          } else {
            legacyEdges.forEach((edge: any) => {
              results.push(`  - ${edge.name} (${edge.href})`);
            });
          }
          
        } catch (legacyError) {
          results.push(`Legacy API also failed: ${(legacyError as any).response?.status || 'error'}`);
        }
      }
      
      return {
        content: [
          {
            type: 'text',
            text: results.join('\n'),
          },
        ],
      };
      
    } catch (error) {
      throw new Error(`Failed to list firewall rules: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleListTasks(hours?: number) {
    await this.ensureAuthenticated();
    
    try {
      const lookbackHours = hours || 24;
      const startTime = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
      const startTimeString = startTime.toISOString();
      
      const results: string[] = [];
      results.push(`Searching for tasks in the last ${lookbackHours} hours (since ${startTimeString})`);
      
      const response = await this.vcdClient.get('/api/query?type=task&sortDesc=startDate', {
        headers: {
          'Accept': `application/*+xml;version=${this.config.apiVersion}`,
          'Authorization': `Bearer ${this.session?.token}`
        }
      });
      
      let tasks = [];
      if (typeof response.data === 'string') {
        try {
          const parsed = await parseStringPromise(response.data);
          if (parsed.QueryResultRecords && parsed.QueryResultRecords.TaskRecord) {
            tasks = parsed.QueryResultRecords.TaskRecord.map((record: any) => ({
              name: record.$.name,
              status: record.$.status,
              startTime: record.$.startDate,
              endTime: record.$.endDate,
              ownerName: record.$.ownerName,
              operation: record.$.operation || record.$.operationFull,
              objectName: record.$.objectName,
              details: record.$.details || record.$.message,
            }));
            
            // Filter by time after parsing
            tasks = tasks.filter((task: any) => {
              if (task.startTime) {
                const taskStart = new Date(task.startTime);
                return taskStart >= startTime;
              }
              return false;
            });
            
          }
        } catch (xmlError) {
          results.push('Failed to parse XML response from legacy API');
        }
      }
      
      results.push(`\nLegacy API Tasks (${tasks.length} found):`);
      if (tasks.length === 0) {
        results.push('  No tasks found in the specified time range');
      } else {
        tasks.forEach((task: any, index: number) => {
          results.push(`  ${index + 1}. ${task.name || 'Unnamed Task'}`);
          results.push(`     Status: ${task.status || 'N/A'}`);
          results.push(`     Start Time: ${task.startTime || 'N/A'}`);
          results.push(`     End Time: ${task.endTime || 'Running'}`);
          results.push(`     Owner: ${task.ownerName || 'N/A'}`);
          results.push(`     Operation: ${task.operation || 'N/A'}`);
          results.push(`     Object: ${task.objectName || 'N/A'}`);
          if (task.details) results.push(`     Details: ${task.details}`);
          results.push('');
        });
      }
     
      return {
        content: [
          {
            type: 'text',
            text: results.join('\n'),
          },
        ],
      };
      
    } catch (error) {
      throw new Error(`Failed to list tasks: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // VM Management Handlers
private async handleVmConfigure(vmId?: string, cpuCount?: number, memoryMB?: number) {
  await this.ensureAuthenticated();

  try {
    if (!vmId) throw new Error('VM ID is required');
    if (!cpuCount && !memoryMB) throw new Error('At least one parameter (cpuCount or memoryMB) is required');

    const url = `/api/vApp/${vmId}`;

    const getResponse = await this.vcdClient.get(url, {
      headers: {
        'Accept': `application/vnd.vmware.vcloud.vm+xml;version=${this.config.apiVersion}`,
        'Authorization': `Bearer ${this.session?.token}`
      }
    });

    if (typeof getResponse.data !== 'string') {
      throw new Error('Invalid response format');
    }

    let xml = getResponse.data;

    if (cpuCount !== undefined) {
      xml = xml.replace(
        /(<ovf:Item[^>]*>.*?<rasd:ResourceType>3<\/rasd:ResourceType>.*?<rasd:VirtualQuantity>)(\d+)(<\/rasd:VirtualQuantity>)/s,
        `$1${cpuCount}$3`
      );
      xml = xml.replace(
        /(<ovf:Item[^>]*>.*?<rasd:ResourceType>3<\/rasd:ResourceType>.*?<rasd:ElementName>)(.*?)(<\/rasd:ElementName>)/s,
        `$1${cpuCount} virtual CPU(s)$3`
      );
    }

    if (memoryMB !== undefined) {
      xml = xml.replace(
        /(<ovf:Item[^>]*>.*?<rasd:ResourceType>4<\/rasd:ResourceType>.*?<rasd:VirtualQuantity>)(\d+)(<\/rasd:VirtualQuantity>)/s,
        `$1${memoryMB}$3`
      );
      xml = xml.replace(
        /(<ovf:Item[^>]*>.*?<rasd:ResourceType>4<\/rasd:ResourceType>.*?<rasd:ElementName>)(.*?)(<\/rasd:ElementName>)/s,
        `$1${memoryMB} MB of memory$3`
      );
    }

    const postUrl = `${url}/action/reconfigureVm`;
    await this.vcdClient.post(postUrl, xml, {
      headers: {
        'Content-Type': `application/vnd.vmware.vcloud.vm+xml; charset=ISO-8859-1`,
        'Accept': `application/vnd.vmware.vcloud.task+xml;version=${this.config.apiVersion}`,
        'Authorization': `Bearer ${this.session?.token}`
      }
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            vmId,
            cpuCount,
            memoryMB,
            status: 'reconfiguration requested'
          }, null, 2),
        },
      ],
    };
  } catch (error) {
    throw new Error(`Failed to configure VM: ${error instanceof Error ? error.message : String(error)}`);
  }
}

  private async handleVmCreateSnapshot(vmId?: string, snapshotName?: string) {
    await this.ensureAuthenticated();
    
    try {
      if (!vmId) throw new Error('VM ID is required');
      if (!snapshotName) throw new Error('Snapshot name is required');
      
      const payload = {
        name: snapshotName,
        memory: true,
        quiesce: false
      };
      
      const response = await this.vcdClient.post(`/cloudapi/1.0.0/vm/${getUrn(vmId)}/snapshots`, payload, {
        headers: {
          'Accept': `application/json;version=${this.config.apiVersion}`,
          'Authorization': `Bearer ${this.session?.token}`
        }
      });
      
      return {
        content: [
          {
            type: 'text',
            text: `Snapshot '${snapshotName}' creation initiated for VM ${vmId}. Task ID: ${response.headers.location.split('/').pop() || 'N/A'}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to create snapshot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleVmListSnapshots(vmId?: string) {
    await this.ensureAuthenticated();
    
    try {
      if (!vmId) throw new Error('VM ID is required');
      
      const response = await this.vcdClient.get(`/cloudapi/1.0.0/vm/${getUrn(vmId)}/snapshots?page=1&pageSize=128`, {
        headers: {
          'Accept': `application/json;version=${this.config.apiVersion}`,
          'Authorization': `Bearer ${this.session?.token}`
        }
      });
      const snapshots = response.data.values || [];
      
      return {
        content: [
          {
            type: 'text',
            text: `Found ${snapshots.length} snapshots for VM ${vmId}:\n${snapshots.map((snapshot: any, index: number) => 
              `${index + 1}. '${snapshot.name}' (created: ${snapshot.dateCreated}, size: ${snapshot.storageConsumedMb || 'N/A'} MB, ID: ${snapshot.id})`
            ).join('\n') || '(none)'}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to list snapshots: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleVmRestoreSnapshot(vmId?: string, snapshotId?: string) {
    await this.ensureAuthenticated();
    
    try {
      if (!vmId) throw new Error('VM ID is required');
      if (!snapshotId) throw new Error('Snapshot ID is required');
      
      const response = await this.vcdClient.post(`/cloudapi/1.0.0/vm/${getUrn(vmId)}/snapshots/${snapshotId}/revert`, null, {
        headers: {
          'Accept': `application/json;version=${this.config.apiVersion}`,
          'Authorization': `Bearer ${this.session?.token}`
        }
      });
      
      return {
        content: [
          {
            type: 'text',
            text: `Snapshot restore initiated for VM ${vmId}. Task ID:  ${response.headers.location.split('/').pop() || 'N/A'}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to restore snapshot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleVappClone(vappId?: string, vdcId?: string, newVappName?: string) {
    await this.ensureAuthenticated();

    try {
      if (!vappId) throw new Error('vApp ID is required');
      if (!vdcId) throw new Error('VDC ID is required');

      // Step 1: Get source vApp configuration
      const getResponse = await this.vcdClient.get(
        `/api/vApp/${vappId}`,
        {
          headers: {
            'Accept': `application/vnd.vmware.vcloud.vApp+xml;version=${this.config.apiVersion}`,
          }
        }
      );

      const sourceVapp = getResponse.data;

      // Parse name and href from XML string
      let vappName = '';
      let vappHref = '';

      if (typeof sourceVapp === 'string') {
        const nameMatch = sourceVapp.match(/name="([^"]+)"/);
        const hrefMatch = sourceVapp.match(/href="([^"]+)"/);

        if (nameMatch) vappName = nameMatch[1];
        if (hrefMatch) vappHref = hrefMatch[1];
      } else if (sourceVapp.name && sourceVapp.href) {
        vappName = sourceVapp.name;
        vappHref = sourceVapp.href;
      }

      // Step 2: Build clone name
      const cloneVappName = newVappName || (vappName ? vappName + '-clone' : 'vapp-clone');

      // Step 3: Build CloneVAppParams XML
      const cloneVAppParamsXml = `<?xml version="1.0" encoding="UTF-8"?>
<CloneVAppParams
   xmlns="http://www.vmware.com/vcloud/v1.5"
   xmlns:ovf="http://schemas.dmtf.org/ovf/envelope/1"
   name="${cloneVappName}"
   deploy="false"
   powerOn="false"
   linkedClone="false">
   <Description>Clone of ${vappName}</Description>
   <Source href="${vappHref}"/>
   <IsSourceDelete>false</IsSourceDelete>
</CloneVAppParams>`;

      // Step 4: POST to /vdc/{id}/action/cloneVApp
      const cloneResponse = await this.vcdClient.post(
        `/api/vdc/${vdcId}/action/cloneVApp`,
        cloneVAppParamsXml,
        {
          headers: {
            'Content-Type': `application/vnd.vmware.vcloud.cloneVAppParams+xml;version=${this.config.apiVersion}`,
            'Accept': `application/vnd.vmware.vcloud.vApp+xml;version=${this.config.apiVersion}`,
          }
        }
      );

      // Extract task ID and clone vApp ID
      let taskId = 'N/A';
      let cloneVappId = cloneVappName;

      if (cloneResponse.data) {
        if (typeof cloneResponse.data === 'string') {
          const taskMatch = cloneResponse.data.match(/id="(urn:vcloud:task:[^"]+)"/);
          if (taskMatch) taskId = taskMatch[1];

          const vappIdMatch = cloneResponse.data.match(/id="(urn:vcloud:vapp:[^"]+)"/);
          if (vappIdMatch) cloneVappId = vappIdMatch[1];
        } else if (cloneResponse.data.Tasks && cloneResponse.data.Tasks.Task) {
          const task = Array.isArray(cloneResponse.data.Tasks.Task) ? cloneResponse.data.Tasks.Task[0] : cloneResponse.data.Tasks.Task;
          if (task.id) taskId = task.id;
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: `VApp clone operation initiated successfully.\nSource vApp: ${vappName} (${vappId})\nClone vApp: ${cloneVappName}\nClone vApp ID: ${cloneVappId}\nTask ID: ${taskId}`,
          },
        ],
      };
    } catch (error) {
      // Check for DUPLICATE_NAME error
      if (error && typeof error === 'object' && 'response' in error) {
        const err = error as any;
        const responseData = typeof err.response?.data === 'string' ? err.response?.data : '';

        if (responseData.includes('DUPLICATE_NAME') || responseData.includes('already exists')) {
          // Extract vApp name from error message
          const nameMatch = responseData.match(/entity ([^ ]+) already/);
          const existingVappName = nameMatch ? nameMatch[1] : 'clone';

          return {
            content: [
              {
                type: 'text',
                text: `VApp clone failed: vApp "${existingVappName}" already exists. Use a different name or delete the existing clone first.`,
              },
            ],
          };
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: `Failed to clone vApp: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  }

  // Storage Management Handlers
  private async handleListDatastores(vdcId?: string) {
    await this.ensureAuthenticated();
    
    try {
      // Use legacy API for storage profiles
      const response = await this.vcdClient.get('/api/query?type=orgVdcStorageProfile', {
        headers: {
          'Accept': `application/*+xml;version=${this.config.apiVersion}`,
          'Authorization': `Bearer ${this.session?.token}`
        }
      });
      
      let storageProfiles = [];
      if (typeof response.data === 'string') {
        try {
          const parsed = await parseStringPromise(response.data);
          if (parsed.QueryResultRecords && parsed.QueryResultRecords.OrgVdcStorageProfileRecord) {
            storageProfiles = parsed.QueryResultRecords.OrgVdcStorageProfileRecord.map((record: any) => ({
              name: record.$.name,
              enabled: record.$.isEnabled === 'true',
              isDefault: record.$.isDefaultStorageProfile === 'true',
              storageUsedMB: record.$.storageUsedMB,
              storageLimitMB: record.$.storageLimitMB,
              vdcName: record.$.vdcName,
              href: record.$.href
            }));
          }
        } catch (xmlError) {
          console.error('Failed to parse storage profiles XML:', xmlError);
        }
      }
      
      let filteredProfiles = storageProfiles;
      if (vdcId) {
        // Filter by VDC name since we don't have direct VDC ID matching
        const vdcResponse = await this.vcdClient.get(`/cloudapi/1.0.0/vdcs/${vdcId}`);
        const vdcName = vdcResponse.data.name;
        filteredProfiles = storageProfiles.filter((profile: any) => 
          profile.vdcName === vdcName
        );
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Found ${filteredProfiles.length} storage profiles:\n${filteredProfiles.map((profile: any, index: number) => 
              `${index + 1}. ${profile.name} (Enabled: ${profile.enabled}, Default: ${profile.isDefault}, Used: ${profile.storageUsedMB || 0}MB / ${profile.storageLimitMB || 'Unlimited'}MB, VDC: ${profile.vdcName})`
            ).join('\n') || '(none)'}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to list datastores: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleVmAddDisk(vmId?: string, diskSizeMB?: number, diskName?: string) {
    await this.ensureAuthenticated();

    try {
      if (!vmId) throw new Error('VM ID is required');
      if (!diskSizeMB) throw new Error('Disk size is required');

      // Get current VM configuration
      const vmResponse = await this.vcdClient.get(`/api/vApp/${vmId}`, {
        headers: {
          'Accept': `application/vnd.vmware.vcloud.vm+xml;version=${this.config.apiVersion}`
        }
      });

      const currentXml = typeof vmResponse.data === 'string' ? vmResponse.data : String(vmResponse.data);

      // Find VmSpecSection
      const vmSpecSectionMatch = currentXml.match(/<VmSpecSection>([\s\S]*?)<\/VmSpecSection>/);
      if (!vmSpecSectionMatch) throw new Error('Could not find VmSpecSection');
      const vmSpecSection = vmSpecSectionMatch[1];

      // Find all existing DiskSettings blocks to link BusNumber with UnitNumber
      const diskSettingsMatches = vmSpecSection.match(/<DiskSettings[^>]*>[\s\S]*?<\/DiskSettings>/g) || [];

      // Determine newBusNumber from all disks
      const allBusNumbers: number[] = [];
      for (const diskBlock of diskSettingsMatches) {
        const busMatch = diskBlock.match(/<BusNumber>(\d+)<\/BusNumber>/);
        if (busMatch) {
          allBusNumbers.push(parseInt(busMatch[1]));
        }
      }
      let newBusNumber = allBusNumbers.length > 0 ? Math.max(...allBusNumbers) : 0;

      // Find max UnitNumber only for disks with BusNumber = newBusNumber
      let maxUnitNumber = -1;
      for (const diskBlock of diskSettingsMatches) {
        const busMatch = diskBlock.match(/<BusNumber>(\d+)<\/BusNumber>/);
        const unitMatch = diskBlock.match(/<UnitNumber>(\d+)<\/UnitNumber>/);
        if (busMatch && unitMatch && parseInt(busMatch[1]) === newBusNumber) {
          const unitNum = parseInt(unitMatch[1]);
          if (unitNum > maxUnitNumber) maxUnitNumber = unitNum;
        }
      }
      let newUnitNumber = maxUnitNumber + 1;

      // Adjust bus number if unit number exceeds 15
      if (newUnitNumber > 15 && newBusNumber < 3) {
        newBusNumber++;
        newUnitNumber = 0;
      } else if (newUnitNumber > 15) {
        throw new Error('Maximum number of disks exceeded (4 buses × 16 units = 64 disks)');
      }

      // Find current max DiskId to generate next sequential ID
      const diskIdMatches = vmSpecSection.match(/<DiskId>(\d+)<\/DiskId>/g) || [];
      let maxDiskId = 128;
      for (const match of diskIdMatches) {
        const num = parseInt(match.match(/>(\d+)</)?.[1] || '0');
        if (num > maxDiskId) maxDiskId = num;
      }
      const diskId = String(maxDiskId + 1);

      // Find Vm element with attributes
      const vmMatch = currentXml.match(/<Vm([^>]+)>/);
      if (!vmMatch) throw new Error('Could not find Vm element');
      const vmAttributes = vmMatch[1];

      // Find StorageProfile href/id/type/name to reuse
      const storageProfileMatch = vmSpecSection.match(/<StorageProfile[^>]*href="([^"]+)"[^>]*id="([^"]+)"[^>]*type="([^"]+)"[^>]*name="([^"]+)"\/>/);
      let storageProfileXml = '';
      if (storageProfileMatch) {
        storageProfileXml = `<StorageProfile href="${storageProfileMatch[1]}" id="${storageProfileMatch[2]}" type="${storageProfileMatch[3]}" name="${storageProfileMatch[4]}"/>`;
      }

      // Build new DiskSection: existing disks + new disk
      const diskSectionMatch = vmSpecSection.match(/<DiskSection>([\s\S]*?)<\/DiskSection>/);
      let newDiskSection = '<DiskSection>';

      if (diskSectionMatch) {
        // Keep existing disks (everything except closing tag)
        const existingContent = diskSectionMatch[1].replace(/<\/DiskSection>$/, '');
        newDiskSection += existingContent;
      }

      // Add new disk
      newDiskSection += `
            <DiskSettings>
                <DiskId>${diskId}</DiskId>
                <SizeMb>${diskSizeMB}</SizeMb>
                <UnitNumber>${newUnitNumber}</UnitNumber>
                <BusNumber>${newBusNumber}</BusNumber>
                <AdapterType name="SCSIPARAVIRTUAL">5</AdapterType>
                <ThinProvisioned>true</ThinProvisioned>
                ${storageProfileXml}
                <overrideVmDefault>false</overrideVmDefault>
                <VirtualQuantityUnit>byte</VirtualQuantityUnit>
                <resizable>true</resizable>
                <shareable>false</shareable>
                <sharingType>None</sharingType>
            </DiskSettings>`;

      newDiskSection += '\n        </DiskSection>';

      // Replace DiskSection in the VmSpecSection and add Modified="true"
      const newVmSpecSection = `<VmSpecSection Modified="true">${vmSpecSection.replace(/<DiskSection>[\s\S]*?<\/DiskSection>/, newDiskSection)}</VmSpecSection>`;

      // Build final XML
      const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<Vm${vmAttributes}>
${newVmSpecSection}
</Vm>`;

      const url = `/api/vApp/${vmId}/action/reconfigureVm`;
      const headers = {
        'Content-Type': 'application/*+xml;charset=UTF-8',
        'Accept': `application/*+xml;version=${this.config.apiVersion}`
      };

      const response = await this.vcdClient.post(url, xmlPayload, { headers });

      const xmlData = typeof response.data === 'string' ? response.data : String(response.data);

      const taskIdMatch = xmlData.match(/id="([^"]*task[^"]*)"/) || xmlData.match(/id="urn:vcloud:task:([^"]+)"/);
      const taskId = taskIdMatch ? taskIdMatch[1] : 'N/A';

      const taskHrefMatch = xmlData.match(/href="([^"]*task[^"]*)"/);
      const taskHref = taskHrefMatch ? taskHrefMatch[1] : 'N/A';

      const taskStatusMatch = xmlData.match(/status="([^"]+)"/);
      const taskStatus = taskStatusMatch ? taskStatusMatch[1] : 'N/A';

      return {
        content: [
          {
            type: 'text',
            text: `Disk addition initiated for VM ${vmId}\n\n` +
              `--- Request Info ---\n` +
              `URL: ${url}\n` +
              `Disk ID: ${diskId}\n` +
              `Disk Size: ${diskSizeMB} MB (${diskSizeMB / 1024} GB)\n` +
              `Disk Name: ${diskName || diskId}\n` +
              `Unit Number: ${newUnitNumber}\n` +
              `Bus Number: ${newBusNumber}\n\n` +
              `--- Response Info ---\n` +
              `Status: ${response.status} ${response.statusText}\n` +
              `Task ID: ${taskId}\n` +
              `Task Href: ${taskHref}\n` +
              `Task Status: ${taskStatus}`
          },
        ],
      };
    } catch (error: any) {
      const axiosError = error as any;
      const responseDebug = axiosError.response ? {
        status: axiosError.response.status,
        statusText: axiosError.response.statusText,
        data: axiosError.response.data
      } : null;

      throw new Error(`Failed to add disk: ${responseDebug ? `${responseDebug.status} ${responseDebug.statusText} - ${responseDebug.data}` : String(error)}`);
    }
  }

  private async handleVmListDisks(vmId?: string) {
    await this.ensureAuthenticated();

    try {
      if (!vmId) throw new Error('VM ID is required');

      const response = await this.vcdClient.get(`/api/vApp/${vmId}/virtualHardwareSection/disks`, {
        headers: {
          'Accept': `application/vnd.vmware.vcloud.rasdItemsList+xml;version=${this.config.apiVersion}`
        }
      });

      const xmlData = typeof response.data === 'string' ? response.data : String(response.data);

      const parseItem = (itemText: string): any => {
        const getValue = (tag: string): string | null => {
          const valueMatch = itemText.match(`<rasd:${tag}[^>]*>([^<]*)</rasd:${tag}>`);
          return valueMatch ? valueMatch[1].trim() : null;
        };

        const parseHostResource = (itemText: string): any => {
          const result: any = {};
          const hostResourceMatch = itemText.match(/<rasd:HostResource([^>]*)>/);
          if (hostResourceMatch) {
            const hostContent = hostResourceMatch[1];
            const storageProfileHref = hostContent.match(/[a-zA-Z0-9]+:storageProfileHref\s*=\s*["']([^"']+)["']/);
            const busType = hostContent.match(/[a-zA-Z0-9]+:busType\s*=\s*["']([^"']+)["']/);
            const busSubType = hostContent.match(/[a-zA-Z0-9]+:busSubType\s*=\s*["']([^"']+)["']/);
            const capacity = hostContent.match(/[a-zA-Z0-9]+:capacity\s*=\s*["']([^"']+)["']/);
            const iops = hostContent.match(/[a-zA-Z0-9]+:iops\s*=\s*["']([^"']+)["']/);
            if (storageProfileHref) result.storageProfileHref = storageProfileHref[1];
            if (busType) result.busType = busType[1];
            if (busSubType) result.busSubType = busSubType[1];
            if (capacity) result.capacity = capacity[1];
            if (iops) result.iops = iops[1];
          }
          return result;
        };

        return {
          ElementName: getValue('ElementName'),
          InstanceID: getValue('InstanceID'),
          AddressOnParent: getValue('AddressOnParent'),
          Parent: getValue('Parent'),
          Description: getValue('Description'),
          ResourceType: getValue('ResourceType'),
          HostResource: parseHostResource(itemText)
        };
      };

      const itemMatches = xmlData.match(/<Item>(.*?)<\/Item>/gs) || [];
      const items = itemMatches.map(parseItem);
      const disks = items.filter((item: any) => item.ResourceType === '17');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${disks.length} disks for VM ${vmId}:\n\n` +
              disks.map((disk: any, index: number) =>
                `${index + 1}. ${disk.ElementName || 'Unnamed Disk'}\n` +
                `   Size: ${disk.HostResource?.capacity || 'N/A'} MB (${disk.HostResource?.capacity ? parseFloat(disk.HostResource.capacity) / 1024 + ' GB' : 'N/A'})\n` +
                `   Bus Type: ${disk.HostResource?.busType || 'N/A'}\n` +
                `   Bus SubType: ${disk.HostResource?.busSubType || 'N/A'}\n` +
                `   IOPS: ${disk.HostResource?.iops || 'N/A'}\n` +
                `   InstanceID: ${disk.InstanceID}\n` +
                `   Parent Controller: ${disk.Parent}\n` +
                `   AddressOnParent: ${disk.AddressOnParent}`
              ).join('\n\n') || '(none)'
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to list disks: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleVmResizeDisk(vmId?: string, diskBusNumber?: string, diskUnitNumber?: string, diskSizeMB?: number) {
    await this.ensureAuthenticated();

    try {
      if (!vmId) throw new Error('VM ID is required');
      if (!diskBusNumber) throw new Error('BusNumber of disk is required');
      if (!diskUnitNumber) throw new Error('UnitNumber of disk is required');
      if (!diskSizeMB) throw new Error('New disk size is required');

      // Get current VM configuration
      const vmResponse = await this.vcdClient.get(`/api/vApp/${vmId}`, {
        headers: {
          'Accept': `application/vnd.vmware.vcloud.vm+xml;version=${this.config.apiVersion}`
        }
      });

      const currentXml = typeof vmResponse.data === 'string' ? vmResponse.data : String(vmResponse.data);

      // Find VmSpecSection
      const vmSpecSectionMatch = currentXml.match(/<VmSpecSection>([\s\S]*?)<\/VmSpecSection>/);
      if (!vmSpecSectionMatch) throw new Error('Could not find VmSpecSection');
      const vmSpecSection = vmSpecSectionMatch[1];

      // Find all DiskSettings blocks
      const diskSettingsMatches = vmSpecSection.match(/<DiskSettings[^>]*>[\s\S]*?<\/DiskSettings>/g) || [];

      // Find the target disk by diskBusNumber and diskUnitNumber
      let targetDiskIndex = -1;
      let currentDiskSizeMB: number | null = null;

      for (let i = 0; i < diskSettingsMatches.length; i++) {
        const diskBlock = diskSettingsMatches[i];
        const busMatch = diskBlock.match(/<BusNumber>(\d+)<\/BusNumber>/);
        const unitMatch = diskBlock.match(/<UnitNumber>(\d+)<\/UnitNumber>/);
        const sizeMatch = diskBlock.match(/<SizeMb>(\d+)<\/SizeMb>/);

        if (busMatch && unitMatch && sizeMatch) {
          const diskBus = parseInt(busMatch[1]);
          const diskUnit = parseInt(unitMatch[1]);

          if (diskBus === parseInt(diskBusNumber) && diskUnit === parseInt(diskUnitNumber)) {
            targetDiskIndex = i;
            currentDiskSizeMB = parseInt(sizeMatch[1]);
            break;
          }
        }
      }

      if (targetDiskIndex === -1) {
        throw new Error(`Disk with BusNumber=${diskBusNumber} and UnitNumber=${diskUnitNumber} not found`);
      }

      if (currentDiskSizeMB !== null && currentDiskSizeMB >= diskSizeMB) {
        throw new Error(`Current disk size (${currentDiskSizeMB} MB) is already greater than or equal to requested size (${diskSizeMB} MB)`);
      }

      // Find Vm element with attributes
      const vmMatch = currentXml.match(/<Vm([^>]+)>/);
      if (!vmMatch) throw new Error('Could not find Vm element');
      const vmAttributes = vmMatch[1];

      // Build new DiskSection with updated disk size
      const diskSectionMatch = vmSpecSection.match(/<DiskSection>([\s\S]*?)<\/DiskSection>/);
      let newDiskSection = '<DiskSection>';

      if (diskSectionMatch) {
        // Update the target disk's size
        const diskBlocks = diskSettingsMatches;
        let updatedContent = '';

        for (let i = 0; i < diskBlocks.length; i++) {
          if (i === targetDiskIndex) {
            // Replace SizeMb in target disk
            updatedContent += diskBlocks[i].replace(/<SizeMb>\d+<\/SizeMb>/, `<SizeMb>${diskSizeMB}</SizeMb>`);
          } else {
            updatedContent += diskBlocks[i];
          }
        }

        newDiskSection += updatedContent;
      }

      newDiskSection += '</DiskSection>';

      // Replace DiskSection in the VmSpecSection and add Modified="true"
      const newVmSpecSection = `<VmSpecSection Modified="true">${vmSpecSection.replace(/<DiskSection>[\s\S]*?<\/DiskSection>/, newDiskSection)}</VmSpecSection>`;

      // Build final XML
      const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<Vm${vmAttributes}>
${newVmSpecSection}
</Vm>`;

      const url = `/api/vApp/${vmId}/action/reconfigureVm`;
      const headers = {
        'Content-Type': 'application/*+xml;charset=UTF-8',
        'Accept': `application/*+xml;version=${this.config.apiVersion}`
      };

      const response = await this.vcdClient.post(url, xmlPayload, { headers });

      const xmlData = typeof response.data === 'string' ? response.data : String(response.data);

      const taskIdMatch = xmlData.match(/id="([^"]*task[^"]*)"/) || xmlData.match(/id="urn:vcloud:task:([^"]+)"/);
      const taskId = taskIdMatch ? taskIdMatch[1] : 'N/A';

      const taskHrefMatch = xmlData.match(/href="([^"]*task[^"]*)"/);
      const taskHref = taskHrefMatch ? taskHrefMatch[1] : 'N/A';

      const taskStatusMatch = xmlData.match(/status="([^"]+)"/);
      const taskStatus = taskStatusMatch ? taskStatusMatch[1] : 'N/A';

      return {
        content: [
          {
            type: 'text',
            text: `Disk resize initiated for VM ${vmId}\n\n` +
              `--- Request Info ---\n` +
              `URL: ${url}\n` +
              `BusNumber: ${diskBusNumber}\n` +
              `UnitNumber: ${diskUnitNumber}\n` +
              `Old Size: ${currentDiskSizeMB} MB\n` +
              `New Size: ${diskSizeMB} MB (${diskSizeMB / 1024} GB)\n\n` +
              `--- Response Info ---\n` +
              `Task ID: ${taskId}\n` +
              `Task Href: ${taskHref}\n` +
              `Task Status: ${taskStatus}`
          },
        ],
      };
    } catch (error: any) {
      const axiosError = error as any;
      const responseDebug = axiosError.response ? {
        status: axiosError.response.status,
        statusText: axiosError.response.statusText,
        data: axiosError.response.data
      } : null;

      throw new Error(`Failed to resize disk: ${responseDebug ? `${responseDebug.status} ${responseDebug.statusText} - ${responseDebug.data}` : String(error)}`);
    }
  }

  // Networking Handlers
  private async handleCreateOrgNetwork(networkName?: string, networkType?: string, vdcId?: string, gateway?: string, startAddress?: string, endAddress?: string, prefixLength?: number, dnsServer1?: string, dnsServer2?: string, dnsSuffix?: string) {
    await this.ensureAuthenticated();
    
    try {
      if (!networkName) throw new Error('Network name is required');
      if (!networkType) throw new Error('Network type is required: isolated OR routed');
      if (!vdcId) throw new Error('VDC ID is required');
      if (!gateway) throw new Error('Gateway IP-address is required');
      if (!startAddress) throw new Error('Network range start IP-address is required');
      if (!endAddress) throw new Error('Network range end IP-address is required');
      if (!prefixLength) throw new Error('Network mask is required');

      const payload = {
        "ownerRef": {"id": getUrn(vdcId)},
        "name": networkName,
        "description": `${networkType.charAt(0).toUpperCase() + networkType.slice(1)} network created via MCP`,
        "networkType": networkType.toUpperCase(),
        "guestVlanTaggingAllowed": false,
        "strictIpMode": false,
        "enableDualSubnetNetwork": false,
        "segmentProfileTemplateRef": null,
        "subnets": {
          "values": [
            {
              "gateway": gateway,
              "prefixLength": prefixLength,
              "dnsServer1": dnsServer1,
              "dnsServer2": dnsServer2,
              "dnsSuffix": dnsSuffix || "domain.local",
              "ipRanges": {
                "values": [
                  {
                    "startAddress": startAddress,
                    "endAddress": endAddress
                  }
                ]
              }
            }
          ]
        }
      }
      
      const response = await this.vcdClient.post('/cloudapi/1.0.0/orgVdcNetworks', payload);
      
      return {
        content: [
          {
            type: 'text',
            text: `Organization network '${networkName}' creation initiated. Type: ${networkType}, VDC: ${vdcId}, Task ID: ${response.headers.location.split('/').pop() || 'N/A'}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to create network: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleListNatRules() {
    await this.ensureAuthenticated();
    
    try {
      // Get edge gateways for the VDC
      const edgeResponse = await this.vcdClient.get('/cloudapi/1.0.0/edgeGateways');
      
      const edgeGateways = edgeResponse.data.values || [];
      const results: string[] = [];
      
      for (const edge of edgeGateways) {
        try {
          const natResponse = await this.vcdClient.get(`/cloudapi/1.0.0/edgeGateways/${edge.id}/nat/rules`);
          const natRules = natResponse.data.values || [];
          
          results.push(`Edge Gateway: ${edge.name} (${natRules.length} NAT rules)`);
          natRules.forEach((rule: any, index: number) => {
            results.push(`  ${index + 1}. ${rule.name || 'Unnamed'} - ${rule.type} (${rule.externalAddresses} -> ${rule.internalAddresses})`);
          });
        } catch (error) {
          results.push(`Failed to get NAT rules for ${edge.name}`);
        }
      }
      
      return {
        content: [
          {
            type: 'text',
            text: results.join('\n') || 'No NAT rules found',
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to list NAT rules: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleListDhcpPools(vdcId?: string) {
    await this.ensureAuthenticated();
    
    try {
      if (!vdcId) throw new Error('VDC ID is required');
      
      // Get edge gateways for the VDC
      const edgeResponse = await this.vcdClient.get('/cloudapi/1.0.0/edgeGateways', {
        params: { filter: `orgVdc.id==${vdcId}` }
      });
      
      const edgeGateways = edgeResponse.data.values || [];
      const results: string[] = [];
      
      for (const edge of edgeGateways) {
        try {
          const dhcpResponse = await this.vcdClient.get(`/cloudapi/1.0.0/edgeGateways/${edge.id}/dhcp`);
          const dhcpPools = dhcpResponse.data.pools || [];
          
          results.push(`Edge Gateway: ${edge.name} (${dhcpPools.length} DHCP pools)`);
          dhcpPools.forEach((pool: any, index: number) => {
            results.push(`  ${index + 1}. Range: ${pool.startAddress} - ${pool.endAddress} (Enabled: ${pool.enabled})`);
          });
        } catch (error) {
          results.push(`  Failed to get DHCP pools for ${edge.name}`);
        }
      }
      
      return {
        content: [
          {
            type: 'text',
            text: results.join('\n') || 'No DHCP pools found',
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to list DHCP pools: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleListIpAllocations(vdcId?: string) {
    await this.ensureAuthenticated();
    
    try {
      if (!vdcId) throw new Error('VDC ID is required');
      
      const response = await this.vcdClient.get('/cloudapi/1.0.0/orgVdcNetworks', {
        params: { filter: `orgVdc.id==${vdcId}` }
      });
      
      const networks = response.data.values || [];
      const results: string[] = [];
      
      for (const network of networks) {
        try {
          const allocResponse = await this.vcdClient.get(`/cloudapi/1.0.0/orgVdcNetworks/${network.id}/allocatedIpAddresses`);
          const allocations = allocResponse.data.values || [];
          
          results.push(`Network: ${network.name} (${allocations.length} IP allocations)`);
          allocations.forEach((alloc: any, index: number) => {
            results.push(`  ${index + 1}. ${alloc.ipAddress} - ${alloc.vm?.name || 'Unassigned'}`);
          });
        } catch (error) {
          results.push(`  Failed to get IP allocations for ${network.name}`);
        }
      }
      
      return {
        content: [
          {
            type: 'text',
            text: results.join('\n') || 'No IP allocations found',
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to list IP allocations: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Templates & Catalogs Handlers
  private async handleListCatalogs(orgId?: string) {
    await this.ensureAuthenticated();
    
    try {
      // Use legacy API for catalogs
      const response = await this.vcdClient.get('/api/query?type=catalog', {
        headers: {
          'Accept': `application/*+xml;version=${this.config.apiVersion}`,
          'Authorization': `Bearer ${this.session?.token}`
        }
      });
      
      let catalogs = [];
      if (typeof response.data === 'string') {
        try {
          const parsed = await parseStringPromise(response.data);
          if (parsed.QueryResultRecords && parsed.QueryResultRecords.CatalogRecord) {
            catalogs = parsed.QueryResultRecords.CatalogRecord.map((record: any) => ({
              name: record.$.name,
              description: record.$.description,
              isPublished: record.$.isPublished === 'true',
              isShared: record.$.isShared === 'true',
              numberOfVAppTemplates: record.$.numberOfVAppTemplates,
              numberOfMedia: record.$.numberOfMedia,
              orgName: record.$.orgName,
              href: record.$.href
            }));
          }
        } catch (xmlError) {
          console.error('Failed to parse catalogs XML:', xmlError);
        }
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Found ${catalogs.length} catalogs:\n${catalogs.map((catalog: any, index: number) => 
              `${index + 1}. ${catalog.name} (Templates: ${catalog.numberOfVAppTemplates || 0}, Media: ${catalog.numberOfMedia || 0}, Published: ${catalog.isPublished}, Shared: ${catalog.isShared}, Org: ${catalog.orgName})`
            ).join('\n') || '(none)'}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to list catalogs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleListCatalogItems(catalogName?: string) {
    await this.ensureAuthenticated();
    
    try {
      if (!catalogName) throw new Error('Catalog name is required');
      
      // Use legacy API for catalog items
      const response = await this.vcdClient.get('/api/query?type=catalogItem', {
        headers: {
          'Accept': `application/*+xml;version=${this.config.apiVersion}`,
          'Authorization': `Bearer ${this.session?.token}`
        }
      });
      
      let catalogItems = [];
      if (typeof response.data === 'string') {
        try {
          const parsed = await parseStringPromise(response.data);
          if (parsed.QueryResultRecords && parsed.QueryResultRecords.CatalogItemRecord) {
            catalogItems = parsed.QueryResultRecords.CatalogItemRecord
              .filter((record: any) => record.$.catalogName === catalogName)
              .map((record: any) => ({
                name: record.$.name,
                entityName: record.$.entityName,
                entityType: record.$.entityType,
                catalogName: record.$.catalogName,
                ownerName: record.$.ownerName,
                creationDate: record.$.creationDate,
                vdcName: record.$.vdcName,
                href: record.$.href
              }));
          }
        } catch (xmlError) {
          console.error('Failed to parse catalog items XML:', xmlError);
        }
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Found ${catalogItems.length} items in catalog '${catalogName}':\n${catalogItems.map((item: any, index: number) => 
              `${index + 1}. ${item.name} (Entity: ${item.entityName}, Type: ${item.entityType}, Created: ${item.creationDate}, Owner: ${item.ownerName})`
            ).join('\n') || '(none)'}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to list catalog items: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleGetTemplateDetails(templateName?: string) {
    await this.ensureAuthenticated();
    
    try {
      if (!templateName) throw new Error('Template name is required');
      const allVms: any[] = [];

      try {
        const url = '/api/query?type=vm';
        const response = await this.vcdClient.get(url, {
          headers: {
            'Accept': `application/*+xml;version=${this.config.apiVersion}`,
            'Authorization': `Bearer ${this.session?.token}`
          }
        });

        let items = [];
        if (typeof response.data === 'string') {
          try {
            const parsed = await parseStringPromise(response.data);
            items = parsed.QueryResultRecords.VMRecord.map((record: any) => ({
              name: record.$.name,
              status: record.$.status,
              href: record.$.href,
              vdcName: record.$.vdcName,
              vdcId: record.$.vdc?.split('/').pop(),
              id: record.$.href?.split('/').pop(),
              containerName: record.$.containerName,
              numberOfCpus: record.$.numberOfCpus,
              memoryMB: record.$.memoryMB,
              isVAppTemplate: record.$.isVAppTemplate
            }));
          } catch (xmlError) {
            console.error('Failed to parse XML response:', xmlError);
            items = [];
          }
        } else if (response.data.record) {
          items = response.data.record;
        } else if (Array.isArray(response.data)) {
          items = response.data;
        }

        const filteredVms = items.filter((vm: any) => {
          const nameMatch = !templateName || vm.name?.toLowerCase().includes(templateName.toLowerCase());
          const isTemplate = vm.isVAppTemplate === "true";
          return nameMatch && isTemplate;
        });
        allVms.push(...filteredVms);

      } catch (queryError) {
        throw new Error(`Failed to query VMs: ${(queryError as any).response?.status || 'error'}`);
      }

      const searchText = templateName ? ` named "${templateName}"` : '';

      if (allVms.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No vApp templates found${searchText}.`,
            },
          ],
        };
      }

      const vmList = allVms.map((vm: any) =>
        `- ${vm.name} (Status: ${vm.status}, CPU: ${vm.numberOfCpus || 'N/A'}, Memory: ${vm.memoryMB || 'N/A'}MB, VDC: ${vm.vdcName || 'N/A'}, Container: ${vm.containerName || 'N/A'}, ID: ${vm.id})`
      ).join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${allVms.length} vApp template(s)${searchText}:\n${vmList}`,
          },
        ],
      };      
    } catch (error) {
      throw new Error(`Failed to get template details: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Monitoring & Alerts Handlers
  private async handleGetVmMetrics(vmId?: string) {
    await this.ensureAuthenticated();

    if (!vmId) throw new Error('VM ID is required');
    const currentMetrics: string[] = [];
    try {

      const response = await this.vcdClient.get(`/api/vApp/${vmId}/metrics/current`, {
        headers: {
          'Accept': `application/*+xml;version=${this.config.apiVersion}`,
          'Authorization': `Bearer ${this.session?.token}`
        }
      });
      if (typeof response.data === 'string') {
        try {
          const parsed = await parseStringPromise(response.data);
          const metrics = parsed.CurrentUsage.Metric || [];
          for (const metric of metrics) {
            const name = metric.$.name;
            const unit = metric.$.unit.toLowerCase();
            const value = metric.$.value;
            currentMetrics.push(`${name}: ${value} ${unit};\n`)
          }
        } catch (xmlError) {
          console.error('Failed to parse XML response:', xmlError);
        }
      }
     
      return {
        content: [
          {
            type: 'text',
            text: `VM Metrics for ${vmId}: ${currentMetrics}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `VM metrics not available for ${vmId}. This feature may require specific VCD version or configuration.`,
          },
        ],
      };
    }
  }

  private async handleListEvents(hours?: number) {
    await this.ensureAuthenticated();
    
    try {
      const lookbackHours = hours || 24;
      const startTime = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
      
      const response = await this.vcdClient.get('/cloudapi/1.0.0/auditTrail?page=1&pageSize=128&sortDesc=timestamp', {
        headers: {
          'Accept': `application/json;version=${this.config.apiVersion}`,
          'Authorization': `Bearer ${this.session?.token}`
        }
      });
      let events = response.data.values || [];
      events = events.filter((event: any) => {
        if (event.timestamp) {
          const eventTime = new Date(event.timestamp);
          return eventTime >= startTime;
        }
        return false;
      });
      
      return {
        content: [
          {
            type: 'text',
            text: `Found ${events.length} events in the last ${lookbackHours} hours:\n${events.map((event: any, index: number) => 
              `${index + 1}. ${event.eventType} with status ${event.eventStatus} at ${event.timestamp} by ${event.user.name}: ${event.description}`
            ).join('\n') || '(none)'}`,
          },
        ],
      };

    } catch (error) {
      throw new Error(`Failed to list events: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleGetOrgHealth(orgId?: string) {
    await this.ensureAuthenticated();
    
    try {
      // Get organization details using working CloudAPI
      const orgResponse = await this.vcdClient.get('/cloudapi/1.0.0/orgs');
      const orgs = orgResponse.data.values || [];
      const org = orgId ? orgs.find((o: any) => o.id === orgId) : orgs[0];
      
      if (!org) {
        throw new Error('Organization not found');
      }
      
      // Get VDCs using working CloudAPI
      const vdcResponse = await this.vcdClient.get('/cloudapi/1.0.0/vdcs');
      const vdcs = vdcResponse.data.values || [];
      
      // Get vApp data from legacy API (since VM API doesn't work)
      const vappResponse = await this.vcdClient.get('/api/query?type=vApp', {
        headers: {
          'Accept': `application/*+xml;version=${this.config.apiVersion}`,
          'Authorization': `Bearer ${this.session?.token}`
        }
      });
      
      let vapps = [];
      if (typeof vappResponse.data === 'string') {
        try {
          const parsed = await parseStringPromise(vappResponse.data);
          if (parsed.QueryResultRecords && parsed.QueryResultRecords.VAppRecord) {
            vapps = parsed.QueryResultRecords.VAppRecord;
          }
        } catch (xmlError) {
          console.error('Failed to parse vApps XML:', xmlError);
        }
      }
      
      const runningVapps = vapps.filter((vapp: any) => vapp.$.status === 'POWERED_ON').length;
      const stoppedVapps = vapps.filter((vapp: any) => vapp.$.status === 'POWERED_OFF').length;
      const readyVdcs = vdcs.filter((vdc: any) => vdc.status === 'READY').length;
      
      return {
        content: [
          {
            type: 'text',
            text: `Organization Health Status for '${org.name}':\n\n` +
                  `Organization Status: ${org.isEnabled ? 'Enabled' : 'Disabled'}\n` +
                  `Virtual Data Centers: ${vdcs.length} (${readyVdcs} ready)\n` +
                  `Virtual Applications: ${vapps.length}\n` +
                  `  - Running vApps: ${runningVapps}\n` +
                  `  - Stopped vApps: ${stoppedVapps}\n` +
                  `Running VMs (reported): ${org.runningVMCount || 0}\n` +
                  `Catalogs: ${org.catalogCount || 0}\n` +
                  `Users: ${org.userCount || 0}\n` +
                  `Organization ID: ${org.id}`,
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get organization health: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleGetResourceMetrics(vdcId?: string) {
    await this.ensureAuthenticated();
    
    try {
      if (vdcId) {
        // Get specific VDC details using working CloudAPI
        const vdcResponse = await this.vcdClient.get(`/cloudapi/1.0.0/vdcs/urn:vcloud:vdc:${vdcId}`);
        const vdc = vdcResponse.data;
        
        // Get storage profiles for this VDC
        const storageResponse = await this.vcdClient.get('/api/query?type=orgVdcStorageProfile', {
          headers: {
            'Accept': `application/*+xml;version=${this.config.apiVersion}`,
            'Authorization': `Bearer ${this.session?.token}`
          }
        });
        
        let storageProfiles = [];
        if (typeof storageResponse.data === 'string') {
          try {
            const parsed = await parseStringPromise(storageResponse.data);
            if (parsed.QueryResultRecords && parsed.QueryResultRecords.OrgVdcStorageProfileRecord) {
              storageProfiles = parsed.QueryResultRecords.OrgVdcStorageProfileRecord
                .filter((record: any) => record.$.vdcName === vdc.name);
            }
          } catch (xmlError) {
            console.error('Failed to parse storage profiles XML:', xmlError);
          }
        }
        
        const totalStorage = storageProfiles.reduce((sum: number, profile: any) => 
          sum + parseInt(profile.$.storageLimitMB || '0'), 0);
        const usedStorage = storageProfiles.reduce((sum: number, profile: any) => 
          sum + parseInt(profile.$.storageUsedMB || '0'), 0);
        
        return {
          content: [
            {
              type: 'text',
              text: `Resource Metrics for VDC ${vdc.name}:\n\n` +
                    `Allocation Type: ${vdc.allocationType}\n` +
                    `Organization: ${vdc.org?.name}\n` +
                    `Storage Profiles: ${storageProfiles.length}\n` +
                    `Total Storage: ${totalStorage}MB\n` +
                    `Used Storage: ${usedStorage}MB (${totalStorage > 0 ? Math.round((usedStorage/totalStorage)*100) : 0}%)\n` +
                    `Networking Tenancy: ${vdc.networkingTenancyEnabled ? 'Enabled' : 'Disabled'}\n` +
                    `vApp Network Standby: ${vdc.vappNetworkStandbyEnabled ? 'Enabled' : 'Disabled'}`,
            },
          ],
        };
      } else {
        // Get organization-level metrics using working CloudAPI
        const orgResponse = await this.vcdClient.get('/cloudapi/1.0.0/orgs');
        const orgs = orgResponse.data.values || [];
        const org = orgs[0]; // Get first org
        
        const vdcResponse = await this.vcdClient.get('/cloudapi/1.0.0/vdcs');
        const vdcs = vdcResponse.data.values || [];
        
        const networkResponse = await this.vcdClient.get('/cloudapi/1.0.0/orgVdcNetworks');
        const networks = networkResponse.data.values || [];
        
        const edgeResponse = await this.vcdClient.get('/cloudapi/1.0.0/edgeGateways');
        const edgeGateways = edgeResponse.data.values || [];
        
        return {
          content: [
            {
              type: 'text',
              text: `Organization Resource Metrics:\n\n` +
                    `Organization: ${org.name}\n` +
                    `Total VDCs: ${vdcs.length}\n` +
                    `Total Networks: ${networks.length}\n` +
                    `Shared Networks: ${networks.filter((net: any) => net.shared).length}\n` +
                    `Edge Gateways: ${edgeGateways.length}\n` +
                    `Active Edge Gateways: ${edgeGateways.filter((edge: any) => edge.status === 'REALIZED').length}\n` +
                    `Running VMs: ${org.runningVMCount || 0}\n` +
                    `vApps: ${org.vappCount || 0}\n` +
                    `Catalogs: ${org.catalogCount || 0}`,
            },
          ],
        };
      }
    } catch (error) {
      throw new Error(`Failed to get resource metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private setupErrorHandling() {
    this.server.onerror = (error) => {
      console.error('[MCP Error]', error);
    };

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
//     console.error('VMware Cloud Director MCP server running on stdio');
  }
}

// Start the server
const server = new VmwareCloudDirectorMCPServer();
server.run().catch(console.error);