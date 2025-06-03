# Stage 1: Build frontend assets (Tailwind CSS) if managed by backend
# If your frontend build process (including Tailwind) is separate, you can skip this stage
# or adjust it to copy pre-built assets later.
FROM node:18-alpine AS builder
WORKDIR /app

# Copy files necessary for building CSS
COPY package.json package-lock.json ./
COPY tailwind.config.js postcss.config.js ./
COPY ./public/src/style.css ./public/src/style.css
# If you have other source CSS files Tailwind depends on, copy them too.

# Install all dependencies (including devDependencies for Tailwind CLI)
RUN npm install

# Run the Tailwind CSS build command (ensure this script exists in your package.json)
# This command should output the CSS to a location accessible by the final stage,
# e.g., ./public/assets/css/output.css
RUN npm run tailwind:build

# Stage 2: Setup Node.js application for production
FROM node:18-alpine

WORKDIR /app

# Set environment variables
# These can be overridden at runtime (e.g., with docker run -e or docker-compose.yml)
ENV NODE_ENV="production"
ENV PORT="3000"
# CRITICAL: These secrets MUST be set via environment variables in your deployment environment.
# Do NOT leave default values here for production.
ENV APP_SECRET_STRING="replace_this_in_production_via_env_variable_long_and_random"
ENV JWT_SECRET="replace_this_jwt_secret_in_production_long_and_random"
# ENV SESSION_SECRET="replace_this_session_secret_if_using_sessions_long_and_random"
# Add other necessary environment variables, e.g., DATABASE_URL if using a DB

# Copy package.json and package-lock.json
COPY package.json package-lock.json ./

# Install only production dependencies and clear npm cache
RUN npm install --omit=dev --no-audit --no-fund --prefer-offline && npm cache clean --force

# Copy the rest of the application code from your project's root
# This includes the server/ directory, public/ (with index.html, etc.)
COPY . .

# Copy the built CSS from the builder stage to the final image's public assets directory
# Ensure the destination path matches where your server expects to find it.
COPY --from=builder /app/public/assets/css/output.css ./public/assets/css/output.css

# Create data directories if your application writes files (e.g., for SQLite DB or JSON files)
# For persistent data, these directories should be mapped to Docker volumes at runtime.
RUN mkdir -p ./data ./db
RUN chown -R node:node ./data ./db # Optional: run as non-root user

# Switch to a non-root user for better security (optional but recommended)
# USER node

# Expose the port the application will run on (must match ENV PORT)
EXPOSE ${PORT}

# Command to run the application
# This should match the "start" script in your package.json if applicable
CMD ["node", "server/server.js"]
