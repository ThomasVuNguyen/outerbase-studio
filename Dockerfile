FROM node:20-alpine AS builder

# Setting working directory. All the path will be relative to WORKDIR
WORKDIR /app
# Installing dependencies
COPY package*.json ./
RUN npm install

# Copying source files
COPY . .

# Building app
RUN npm run build

# Copy only standalone server to new image
FROM node:20-alpine
RUN apk add --no-cache curl
WORKDIR /app
ENV HOSTNAME="0.0.0.0"
ENV PORT=3000
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]