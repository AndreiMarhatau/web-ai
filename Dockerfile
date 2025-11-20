FROM python:3.11-slim-bookworm

ARG NODE_MAJOR=20

RUN apt-get update && apt-get install -y \
    wget \
    netcat-traditional \
    gnupg \
    curl \
    unzip \
    xvfb \
    libxss1 \
    libnss3 \
    libnspr4 \
    libasound2 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    xdg-utils \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-unifont \
    dbus \
    xauth \
    x11vnc \
    tigervnc-tools \
    tigervnc-standalone-server \
    supervisor \
    net-tools \
    procps \
    git \
    python3-numpy \
    fontconfig \
    fonts-dejavu \
    fonts-dejavu-core \
    fonts-dejavu-extra \
    vim \
    && rm -rf /var/lib/apt/lists/*

# Install noVNC
RUN git clone https://github.com/novnc/noVNC.git /opt/novnc \
    && git clone https://github.com/novnc/websockify /opt/novnc/utils/websockify \
    && ln -s /opt/novnc/vnc.html /opt/novnc/index.html

# Install Node.js for Playwright tooling
RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/web-ai

# Install uv for dependency management
ENV UV_LINK_MODE=copy
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# Copy dependency metadata and Python sources, then install production dependencies
COPY pyproject.toml uv.lock README.md webai.py ./
COPY src ./src
RUN uv sync --frozen --no-dev

ENV VIRTUAL_ENV=/app/web-ai/.venv
ENV PATH="/app/web-ai/.venv/bin:${PATH}"
ENV PYTHONPATH=/app/web-ai/src

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-browsers
RUN mkdir -p $PLAYWRIGHT_BROWSERS_PATH
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0 playwright install chromium

# Copy application code
COPY . .

RUN cd frontend && npm install && npm run build

RUN mkdir -p /var/log/supervisor
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

EXPOSE 7790 6180 5902 9223

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
