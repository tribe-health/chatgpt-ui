# Stage 1
FROM node:18-alpine AS deps
RUN apk update && apk add --no-cache libc6-compat git
WORKDIR /app
COPY package.json ./
RUN  yarn install

FROM node:18-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN NODE_ENV=production npm run build

FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public
EXPOSE 3434
ENV PORT 3434
CMD ["npm", "start"]
