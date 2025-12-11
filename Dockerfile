# Build stage - for compiling native modules
FROM node:18.19.1-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache --virtual .build-deps alpine-sdk python3 make g++

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies and build native modules
RUN npm ci --ignore-scripts --omit=dev \
    && npm uninstall bcryptjs \
    && npm install bcryptjs \
    && node-gyp -C node_modules/@julusian/freetype2 rebuild \
    && npm cache clean --force

# Production stage - minimal runtime image
FROM node:18.19.1-alpine

WORKDIR /app

# Copy only necessary files from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application files (dist contents go to root to match original structure)
COPY package.json package-lock.json ./
COPY dist ./
COPY ui-dist ./ui-dist

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 4455 8099 5958

CMD ["node", "index.js"]
