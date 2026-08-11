const isMain = process.env.GITHUB_REF_NAME === "main";

const commitAnalyzer = ["@semantic-release/commit-analyzer", { preset: "conventionalcommits" }];
const releaseNotes = ["@semantic-release/release-notes-generator", { preset: "conventionalcommits" }];
const github = ["@semantic-release/github", {}];

module.exports = {
  branches: isMain
    ? ["main"]
    : [
        { name: "main" },
        { name: "release/v*", channel: "rc", prerelease: "rc" },
      ],
  plugins: isMain
    ? [commitAnalyzer, releaseNotes, github]
    : [
        commitAnalyzer,
        releaseNotes,
        ["@semantic-release/changelog", { changelogFile: "CHANGELOG.md" }],
        ["@semantic-release/git", { assets: ["CHANGELOG.md"], message: "chore(release): ${nextRelease.version}" }],
      ],
};
