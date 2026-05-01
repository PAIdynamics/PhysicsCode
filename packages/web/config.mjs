const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://physicscode.ai" : `https://${stage}.physicscode.ai`,
  console: stage === "production" ? "https://physicscode.ai/auth" : `https://${stage}.physicscode.ai/auth`,
  email: "contact@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/anomalyco/physicscode",
  discord: "https://physicscode.ai/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
