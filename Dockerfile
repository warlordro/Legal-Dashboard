FROM node:22-alpine

WORKDIR /app

# Copiaza fisierele build
COPY dist-backend/ ./dist-backend/
COPY dist-frontend/ ./dist-frontend/

# Copiaza .env daca exista (optional)
COPY .env* ./

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "dist-backend/index.cjs"]
