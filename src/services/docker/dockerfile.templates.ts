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
RUN npm install --omit=dev
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

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

  DJANGO: `
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]
`.trim(),
} as const;

export type DockerfileProjectType = keyof typeof DOCKERFILE_TEMPLATES;

/**
 * Container ports per project type — co-located with templates so adding
 * a new project type only requires changes in this one file.
 */
export const CONTAINER_PORTS: Record<DockerfileProjectType, number> = {
  STATIC: 80,
  NODEJS: 3000,
  NEXTJS: 3000,
  DJANGO: 8000,
};
