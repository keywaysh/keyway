const { db } = require("./dist/db");
const { githubAppInstallations, organizations } = require("./dist/db/schema");
const { eq } = require("drizzle-orm");
const { getInstallationToken } = require("./dist/services/github-app.service");

async function test() {
  // Get an org with installation
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.login, "keywaysh") // Change this to your org
  });

  if (!org) {
    console.log("Organization not found");
    process.exit(1);
  }

  console.log("Organization:", org.login, "VCS Install ID:", org.vcsInstallationId);

  // Get installation
  const installation = await db.query.githubAppInstallations.findFirst({
    where: eq(githubAppInstallations.installationId, org.vcsInstallationId)
  });

  if (!installation) {
    console.log("Installation not found");
    process.exit(1);
  }

  console.log("Installation ID:", installation.installationId);

  // Get installation token
  const token = await getInstallationToken(installation.installationId);
  console.log("Token prefix:", token.substring(0, 10) + "...");

  // Test API call
  const response = await fetch(`https://api.github.com/orgs/${org.login}/members?per_page=100`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });

  console.log("Status:", response.status);
  console.log("Headers:", Object.fromEntries(response.headers.entries()));

  const body = await response.text();
  console.log("Body:", body.substring(0, 1000));

  process.exit(0);
}

test().catch(e => { console.error(e); process.exit(1); });
