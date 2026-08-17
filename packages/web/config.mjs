const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://physicscode.ai" : `https://${stage}.physicscode.ai`,
  console: stage === "production" ? "https://physicscode.ai/auth" : `https://${stage}.physicscode.ai/auth`,
  email: "contact@physicscode.ai",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/PAIdynamics/PhysicsCode",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
