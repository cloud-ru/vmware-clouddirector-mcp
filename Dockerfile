# Use Node.js Alpine for minimal image size
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies) for build
# --ignore-scripts prevents automatic 'prepare' build before source files are available
RUN npm ci --ignore-scripts && \
    npm cache clean --force

# Copy source and TypeScript config
COPY tsconfig.json ./
COPY src ./src

# Build the TypeScript code
RUN npm run build

# Remove devDependencies for production stage
RUN npm prune --production

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy built files and production dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/build ./build

# Set NODE_ENV to production
ENV NODE_ENV=production

# Health check for container
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "process.exit(0)"

# Stdio MCP server runs in foreground
CMD ["node", "build/index.js"]
