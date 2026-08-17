const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://physicscode.ai" : `https://${stage}.physicscode.ai`,
  console: stage === "production" ? "https://physicscode.ai/auth" : `https://${stage}.physicscode.ai/auth`,
  email: "contact@physicscode.ai",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/PAIdynamics/PhysicsCode",
  // toolbeam-docs-theme's HeaderLinks.astro renders `name` verbatim with no
  // i18n lookup, so these need to already be display text, not translation
  // keys (app.header.home/app.header.docs exist in src/content/i18n/*.json
  // for other parts of the page, but nothing resolves them here).
  headerLinks: [
    { name: "Home", url: "/" },
    { name: "Docs", url: "/docs/" },
  ],
}
