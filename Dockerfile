FROM node:24-alpine
WORKDIR /app
COPY server.mjs ./
COPY site ./site
ENV HOST=0.0.0.0 PORT=8790
EXPOSE 8790
USER node
CMD ["node", "server.mjs"]
