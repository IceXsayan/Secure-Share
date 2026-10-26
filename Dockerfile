# Use official lightweight Node.js LTS image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy project source files
COPY . .

# Ensure uploads directory exists
RUN mkdir -p uploads

# Expose default port (Render will inject PORT env variable)
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production

# Start the application
CMD ["npm", "start"]
