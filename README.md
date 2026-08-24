# VMware Cloud Director MCP Server

A comprehensive Model Context Protocol (MCP) server that enables AI assistants like Claude to interact with VMware Cloud Director APIs. This server provides 36 tools for managing virtual infrastructure, storage, networking, templates, and monitoring through natural language interactions.

## 🚀 Features

### **Core Infrastructure Management**
- **Authentication Management**: Secure login and session management with VMware Cloud Director
- **Organization Management**: List organizations and get comprehensive resource usage statistics
- **Virtual Data Center Operations**: Browse VDCs and get detailed capability information
- **vApp Management**: List, power control, clone and manage virtual applications
- **Network Management**: Manage organization networks, NAT rules, DHCP pools, and IP allocations

### **Virtual Machine Management**
- **VM Operations**: List, search, and get detailed VM information
- **Power Management**: Complete power control (start, stop, restart, suspend, resume)
- **VM Configuration**: Modify CPU and memory specifications
- **Snapshot Management**: Create, list, and restore VM snapshots

### **Storage Management**
- **Storage Profiles**: List datastores and storage profiles with usage statistics
- **Disk Management**: Add, list, and resize VM disks
- **Storage Monitoring**: Track storage utilization across VDCs

### **Templates & Catalogs**
- **Catalog Management**: Browse organization catalogs and shared resources
- **Template Discovery**: List catalog items including vApp templates and ISO media
- **Template Details**: Get comprehensive information about VM templates

### **Monitoring & Health**
- **Performance Metrics**: Get VM and resource utilization metrics
- **System Events**: List system events and alerts
- **Health Monitoring**: Organization and infrastructure health status
- **Task Tracking**: Monitor recent operations and their status
- **Firewall Management**: List and analyze firewall rules

## 🛠️ Available Tools (36 Total)

### **Authentication & Core (5 tools)**
- `vcd_login` - Authenticate with VMware Cloud Director
- `list_orgs` - List all accessible organizations
- `list_vdcs` - List virtual data centers
- `get_vdc_details` - Get detailed VDC information and capabilities
- `get_resource_usage` - Get comprehensive resource usage statistics

### **vApp Management (3 tools)**
- `list_vapps` - List vApps in a virtual data center
- `vapp_power_action` - Power control for vApps (start, stop, restart, suspend, resume)
- `vapp_clone` - Clone a vApp

### **Virtual Machine Management (6 tools)**
- `list_vms` - List virtual machines with comprehensive search
- `search_vms` - Search VMs by name or VDC
- `get_vm_details` - Get detailed VM information
- `get_vm_details_with_id` - Get detailed information about a virtual machine with ID
- `vm_power_action` - VM power operations
- `vm_configure` - Modify VM CPU and memory specifications

### **VM Advanced Operations (3 tools)**
- `vm_create_snapshot` - Create VM snapshots
- `vm_list_snapshots` - List VM snapshots
- `vm_restore_snapshot` - Restore VM from snapshot

### **Storage Management (4 tools)**
- `list_datastores` - List storage profiles and datastores
- `vm_add_disk` - Add new disks to VMs
- `vm_list_disks` - List VM disks
- `vm_resize_disk` - Resize VM disks

### **Networking (6 tools)**
- `list_networks` - List organization VDC networks
- `list_firewall_rules` - List firewall rules for edge gateways
- `create_org_network` - Create organization networks
- `list_nat_rules` - List NAT rules for edge gateways
- `list_dhcp_pools` - List DHCP pools for edge gateways
- `list_ip_allocations` - List IP address allocations

### **Templates & Catalogs (3 tools)**
- `list_catalogs` - List organization catalogs
- `list_catalog_items` - List items in catalogs
- `get_template_details` - Get VM template details

### **Monitoring & Health (6 tools)**
- `list_tasks` - List recent tasks and operations
- `get_vm_metrics` - Get VM performance metrics
- `list_events` - List system events and alerts
- `get_org_health` - Get organization health status
- `get_resource_metrics` - Get detailed resource utilization metrics
- `health_check` - Check VMware Cloud Director connection status

## 📊 Supported VMware Cloud Director Features

### **✅ Fully Supported**
- Organization and VDC management
- vApp lifecycle operations
- Network configuration and monitoring
- Storage management and monitoring
- Catalog and template management
- Task and event monitoring
- Firewall rule management

### **⚠️ Limited Support**
- VM-level operations (depends on user permissions)
- Advanced networking features (requires NSX-T)
- Snapshot operations (VM must be powered off)

### **❌ Not Supported**
- User and role management
- Provider-level operations
- Advanced security features
- Cross-site operations

## 💬 Example Interactions

### **Infrastructure Management**
- "Show me all organizations and their resource usage"
- "List all VDCs and their capabilities"
- "What's the health status of my organization?"
- "Show me storage utilization across all VDCs"

### **Virtual Machine Operations**
- "List all VMs and their current status"
- "Start the VM named 'web-server-01'"
- "Create a snapshot of the database VM called 'pre-upgrade'"
- "Clone the template VM to create a new development server"
- "Add a 50GB disk to the application server"

### **Network Management**
- "Show me all organization networks and their IP usage"
- "List firewall rules for the production VDC"
- "What NAT rules are configured on the edge gateway?"
- "Show me DHCP pool configurations"

### **Monitoring & Troubleshooting**
- "Show me all tasks from the last 24 hours"
- "What events occurred in the last week?"
- "Get performance metrics for the database VM"
- "Show me the status of all running vApps"

### **Template & Catalog Management**
- "List all available catalogs and their contents"
- "Show me Ubuntu templates in the catalog"
- "What ISO media is available for deployment?"

## 🔒 Security & Best Practices

### **Credential Management**
- Store credentials securely using environment variables
- Use dedicated service accounts with minimal required permissions
- Regularly rotate credentials and API keys
- Never commit credentials to version control

### **Network Security**
- Ensure SSL/TLS encryption for all API communications
- Implement IP allowlisting for production environments
- Use VPN connections for accessing private cloud instances
- Validate SSL certificates in production (disabled in development)

### **Access Control**
- Implement role-based access controls
- Use principle of least privilege
- Monitor and audit API access logs
- Implement session timeouts and re-authentication

## 🔧 Technical Details

### **API Compatibility**
- **CloudAPI 1.0.0**: Primary API for modern operations
- **Legacy XML API**: Fallback for comprehensive resource access
- **Supported VCD Versions**: 37.0+ (tested with 39.1)
- **Authentication**: Bearer token with automatic session management

### **Architecture**
```
src/
├── server.ts          # Main MCP server with all 32 tools
├── index.ts           # Entry point and environment setup
build/                 # Compiled TypeScript output
├── server.js          # Compiled server
├── index.js           # Compiled entry point
```

### **Error Handling**
- Comprehensive error handling for all API operations
- Automatic fallback between CloudAPI and Legacy API
- Graceful handling of permission errors and resource limitations
- Detailed error messages for troubleshooting


## 📦 Installation

This guide shows how to build and run the VMware Cloud Director MCP server using Docker.

### Prerequisites

- Docker installed on your system
- Docker CLI (for push/pull operations)
- VMware Cloud Director credentials

### Building the Docker Image

1. **Clone the repository**
   ```bash
   git clone https://git.sbercloud.tech/edlebedev/vmware-clouddirector-mcp.git
   cd vmware-clouddirector-mcp
   ```

2. **Build**

   ```bash
   docker build -t vmware-clouddirector-mcp:latest .
   ```
3. **Test run**

   ```bash
   docker run -i --rm \
   --name vmware-clouddirector-mcp \
   -e VCD_BASE_URL=https://your_vcd_instance_address \
   -e VCD_USERNAME=your_username \
   -e VCD_PASSWORD=your_api_token \
   -e VCD_ORG=your_organization \
   -e VCD_API_VERSION=39.1 \
   vmware-clouddirector-mcp:latest &
   ```
   
   Must be clear:
   
   ```bash
   docker logs -f vmware-clouddirector-mcp
   ```

4. Stop container

   ```bash
   docker stop vmware-clouddirector-mcp
   ```

### Connecting to Claude MCP

Follow the official instruction: https://code.claude.com/docs/ru/mcp#option-3-add-a-local-stdio-server . 

For example, when using Claude Code in WSL on Win 10:

  ```bash
  claude mcp add vmware-cloud-director \
    -e VCD_BASE_URL=https://your_vcd_instance_address \
    -e VCD_USERNAME=your_username \
    -e VCD_PASSWORD=your_api_token \
    -e VCD_ORG=your_organization \
    -e VCD_API_VERSION=39.1 \
    -- \
    docker run --rm -i --network host -e VCD_BASE_URL -e VCD_USERNAME -e VCD_PASSWORD -e VCD_ORG -e VCD_API_VERSION vmware-clouddirector-mcp:latest
  ```

### Connecting to opencode MCP
  
Follow the official instruction: https://opencode.ai/docs/ru/mcp-servers/


## 🔧 Usage

### Verify MCP Tools

In Claude, test connection by asking:
> List the available VMware Cloud Director tools

### Test Authentication
> Run a health check on VMware Cloud Director connection

## Environment Variables Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `VCD_BASE_URL` | Yes | VMware Cloud Director API URL | `https://vcd.example.com` |
| `VCD_USERNAME` | No | Username | `admin` |
| `VCD_PASSWORD` | Yes | API token | `your_api_token` |
| `VCD_ORG` | Yes | Organization name | `my_org` |
| `VCD_API_VERSION` | Yes | API version | `39.1` |

## Troubleshooting

### Container exits immediately

Check if all required environment variables are set:
```bash
docker run -it --rm \
  -e VCD_BASE_URL=$VCD_BASE_URL \
  vmware-clouddirector-mcp:latest
```

### Permission denied on MCP connection

Ensure the Docker daemon is running and you have permissions to run Docker commands.

### Connection timeout

Check if the VCD instance is reachable from the container network. You might need to add `--network=host` if using local development.

### View container logs
```bash
docker logs <container-id>
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- VMware for the Cloud Director API
- Anthropic for the Model Context Protocol
- The open-source community for tools and libraries

---