import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'spotizerr.svg', '*.svg'],
      injectRegister: 'auto',
      manifest: {
        name: 'Spotizerr',
        short_name: 'Spotizerr',
        description: 'Music downloader and manager for Spotify content',
        theme_color: '#1e293b',
        background_color: '#0f172a',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        lang: 'en',
        orientation: 'portrait-primary',
        categories: ['music', 'entertainment', 'utilities'],
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png', 
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512', 
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: 'apple-touch-icon-180x180.png',
            sizes: '180x180',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/_/, /\/[^/?]+\.[^/]+$/, /^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\./i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 // 24 hours
              }
            }
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              }
            }
          }
        ]
      },
      devOptions: {
        enabled: true,
        type: 'module'
      }
    })
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 1000, // Increase warning limit to 1MB
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React and routing
          'react-vendor': ['react', 'react-dom'],
          'router-vendor': ['@tanstack/react-router'],
          
          // Query and state management
          'query-vendor': ['@tanstack/react-query'],
          
          // UI and icon libraries
          'ui-vendor': ['lucide-react', 'react-icons', 'sonner'],
          
          // Table components (only used in specific routes)
          'table-vendor': ['@tanstack/react-table'],
          
          // Form handling
          'form-vendor': ['react-hook-form', 'use-debounce'],
          
          // HTTP client
          'http-vendor': ['axios'],
          
          // Config components (heavy route with many tabs)
          'config-components': [
            './src/components/config/GeneralTab',
            './src/components/config/DownloadsTab',
            './src/components/config/FormattingTab',
            './src/components/config/AccountsTab',
            './src/components/config/WatchTab',
            './src/components/config/ServerTab',
            './src/components/config/UserManagementTab',
            './src/components/config/ProfileTab'
          ],
          
          // Utilities and helpers
          'utils-vendor': ['uuid'],
        },
        // Additional chunk optimization
        chunkFileNames: () => {
          return `assets/[name]-[hash].js`;
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:7171",
        changeOrigin: true,
      },
    },
  },
});
