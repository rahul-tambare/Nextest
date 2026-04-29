# Stage 1: Build the React Frontend
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Production Server
FROM node:22-alpine
WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy the built frontend UI and the backend server files
COPY --from=builder /app/dist ./dist
COPY server ./server

# Expose the API port
EXPOSE 3001

# Run the Express server in production mode
ENV NODE_ENV=production
CMD ["node", "server/index.js"]
