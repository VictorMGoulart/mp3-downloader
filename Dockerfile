FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3.11-venv \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

RUN pip install --upgrade pip
RUN pip install -U yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN chmod +x /app/entrypoint.sh

RUN npm run build

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "dist/server.js"]
