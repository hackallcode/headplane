import type { Config } from "@react-router/dev/config";

const prefix = process.env.__INTERNAL_PREFIX || "/admin";

export default {
  basename: `${prefix}/`,
  ssr: true,
  future: {
    unstable_optimizeDeps: true,
  },
} satisfies Config;
