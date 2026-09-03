/**
 * Dockerfile templates per project type (PRD §5.4).
 */

export const DOCKERFILE_TEMPLATES = {
  STATIC: `
FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`.trim(),

  NODEJS: `
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
`.trim(),

  NEXTJS: `
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"

{{NEXT_PUBLIC_BUILD_ARGS}}
RUN if [ -f prisma/schema.prisma ]; then npx prisma generate; fi
RUN npm run build
RUN mkdir -p /app/public

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["npm", "start"]
`.trim(),

  NEXTJS_STATIC: `
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"

{{NEXT_PUBLIC_BUILD_ARGS}}
RUN if [ -f prisma/schema.prisma ]; then npx prisma generate; fi
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/out /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`.trim(),

  DJANGO: `
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]
`.trim(),

  REACT: `
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build -- --base=/

FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
RUN printf 'server {\\n  listen 80;\\n  root /usr/share/nginx/html;\\n  index index.html;\\n  location / {\\n    try_files $uri $uri/ /index.html;\\n  }\\n}\\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`.trim(),

  FASTAPI: `
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
`.trim(),

  FLASK: `
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt gunicorn
COPY . .
EXPOSE 5000
CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:5000", "--workers", "2"]
`.trim(),

  VUE: `
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build -- --base=/

FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
RUN printf 'server {\\n  listen 80;\\n  root /usr/share/nginx/html;\\n  index index.html;\\n  location / {\\n    try_files $uri $uri/ /index.html;\\n  }\\n}\\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`.trim(),

  SVELTE: `
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build -- --base=/

FROM nginx:alpine AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
RUN printf 'server {\\n  listen 80;\\n  root /usr/share/nginx/html;\\n  index index.html;\\n  location / {\\n    try_files $uri $uri/ /index.html;\\n  }\\n}\\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`.trim(),

  GO: `
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/server .

FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /app/server ./server
EXPOSE 8080
CMD ["./server"]
`.trim(),

  RUST: `
FROM rust:1.76-slim AS builder
WORKDIR /app
COPY . .
RUN cargo build --release && \\
    binary=$(find target/release -maxdepth 1 -type f -executable | head -1) && \\
    cp "$binary" /usr/local/bin/app

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /usr/local/bin/app ./app
EXPOSE 8080
CMD ["./app"]
`.trim(),

  JAVA: `
FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline -q
COPY src ./src
RUN mvn package -DskipTests -q

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=builder /app/target/*.jar app.jar
EXPOSE 8080
CMD ["java", "-jar", "app.jar"]
`.trim(),
} as const;

export type DockerfileProjectType = keyof typeof DOCKERFILE_TEMPLATES;

/**
 * Container ports per project type — co-located with templates so adding
 * a new project type only requires changes in this one file.
 */
export const CONTAINER_PORTS: Record<DockerfileProjectType, number> = {
  STATIC:       80,
  NODEJS:       3000,
  NEXTJS:       3000,
  NEXTJS_STATIC: 80,  // never used for containers; required by Record type
  DJANGO:       8000,
  REACT:        80,
  FASTAPI:      8000,
  FLASK:        5000,
  VUE:          80,
  SVELTE:       80,
  GO:           8080,
  RUST:         8080,
  JAVA:         8080,
};

/**
 * Generates ARG + ENV lines for NEXT_PUBLIC_* variables so they're
 * available at Next.js build time. These are public by definition
 * (bundled into client JS), so embedding them in the image is safe.
 */
export function injectNextPublicBuildArgs(
  template: string,
  buildArgKeys: string[],
): string {
  const nextPublicKeys = buildArgKeys.filter((k) => k.startsWith('NEXT_PUBLIC_'));
  if (nextPublicKeys.length === 0) {
    return template.replace('{{NEXT_PUBLIC_BUILD_ARGS}}\n', '');
  }
  const lines = nextPublicKeys
    .map((key) => `ARG ${key}\nENV ${key}=$${key}`)
    .join('\n');
  return template.replace('{{NEXT_PUBLIC_BUILD_ARGS}}', lines);
}
