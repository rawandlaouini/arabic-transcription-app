# Use Node.js 20 Alpine as base
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files and install Node.js dependencies
COPY package.json package-lock.json ./
RUN npm install

# Install FFmpeg
RUN apk add --no-cache ffmpeg

# Install Python and pip
RUN apk add --no-cache python3 py3-pip

# Create a virtual environment for Python
RUN python3 -m venv /app/venv

# Upgrade pip in the virtual environment and install Python dependencies
COPY requirements.txt .
RUN /app/venv/bin/pip install --upgrade pip && /app/venv/bin/pip install -r requirements.txt

# Copy font and Python script for file generation
COPY NotoNaskhArabic-Regular.ttf generate_file.py ./

# Copy the rest of the backend code
COPY . .

# Create directories
RUN mkdir -p uploads downloads

# Set the PATH to include the virtual environment
ENV PATH="/app/venv/bin:$PATH"

# Expose port
EXPOSE 8000

# Start the server
CMD ["node", "server.js"]