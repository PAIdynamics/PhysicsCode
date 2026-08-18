// @ts-check
import { defineConfig } from "astro/config"
import starlight from "@astrojs/starlight"
import solidJs from "@astrojs/solid-js"
import cloudflare from "@astrojs/cloudflare"
import theme from "toolbeam-docs-theme"
import config from "./config.mjs"
import { rehypeHeadingIds } from "@astrojs/markdown-remark"
import rehypeAutolinkHeadings from "rehype-autolink-headings"
import { spawnSync } from "child_process"

// Publishing the docs to GitHub Pages (see .github/workflows/docs.yml) needs
// a fully static build with no Cloudflare adapter and a base path matching
// the project-pages URL, instead of the SSR build the real physicscode.ai
// deploy uses (which also serves the dynamic /s/[id] share page - excluded
// from the static build by the workflow before it runs, since GitHub Pages
// can't serve anything server-rendered).
const isGithubPages = process.env.DOCS_TARGET === "github-pages"

// https://astro.build/config
export default defineConfig({
  site: isGithubPages ? "https://paidynamics.github.io" : config.url,
  base: isGithubPages ? "/PhysicsCode" : "/docs",
  output: isGithubPages ? "static" : "server",
  adapter: isGithubPages
    ? undefined
    : cloudflare({
        imageService: "passthrough",
      }),
  // Matches the Cloudflare adapter's "passthrough" image service above -
  // Sharp isn't a project dependency, and images don't need
  // build-time optimization for a docs mirror.
  image: isGithubPages ? { service: { entrypoint: "astro/assets/services/noop" } } : undefined,
  devToolbar: {
    enabled: false,
  },
  server: {
    host: "0.0.0.0",
  },
  markdown: {
    rehypePlugins: [rehypeHeadingIds, [rehypeAutolinkHeadings, { behavior: "wrap" }]],
  },
  build: {},
  integrations: [
    configSchema(),
    solidJs(),
    starlight({
      title: "PhysicsCode",
      locales: {
        root: {
          label: "English",
          lang: "en",
          dir: "ltr",
        },
      },
      favicon: "/favicon-v3.svg",
      head: [
        {
          tag: "link",
          attrs: {
            rel: "icon",
            href: "/favicon-v3.ico",
            sizes: "32x32",
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "icon",
            type: "image/png",
            href: "/favicon-96x96-v3.png",
            sizes: "96x96",
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "apple-touch-icon",
            href: "/apple-touch-icon-v3.png",
            sizes: "180x180",
          },
        },
      ],
      lastUpdated: true,
      expressiveCode: { themes: ["github-light", "github-dark"] },
      social: [{ icon: "github", label: "GitHub", href: config.github }],
      editLink: {
        baseUrl: `${config.github}/edit/main/packages/web/`,
      },
      markdown: {
        headingLinks: false,
      },
      customCss: ["./src/styles/custom.css"],
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
      },
      sidebar: [
        "",
        "config",
        "providers",
        "network",
        "enterprise",
        "troubleshooting",
        {
          label: "Windows",
          link: "windows-wsl",
        },
        {
          label: "Usage",
          items: ["go", "tui", "cli", "web", "ide", "zen", "github", "gitlab"],
        },

        {
          label: "Configure",
          items: [
            "tools",
            "rules",
            "agents",
            "models",
            "themes",
            "keybinds",
            "commands",
            "formatters",
            "permissions",
            "lsp",
            "mcp-servers",
            "acp",
            "skills",
            "custom-tools",
          ],
        },

        {
          label: "Develop",
          items: ["sdk", "server", "plugins", "ecosystem"],
        },
      ],
      components: {
        Hero: "./src/components/Hero.astro",
        Head: "./src/components/Head.astro",
        Header: "./src/components/Header.astro",
        Footer: "./src/components/Footer.astro",
        SiteTitle: "./src/components/SiteTitle.astro",
      },
      plugins: [
        theme({
          headerLinks: config.headerLinks,
        }),
      ],
    }),
  ],
})

function configSchema() {
  return {
    name: "configSchema",
    hooks: {
      "astro:build:done": async () => {
        console.log("generating config schema")
        spawnSync("../physicscode/script/schema.ts", ["./dist/config.json", "./dist/tui.json"])
      },
    },
  }
}
