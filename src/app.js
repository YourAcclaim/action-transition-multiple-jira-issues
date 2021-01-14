const core = require("@actions/core");
const Jira = require("./jira");
const Github = require("./github");

class App {
  constructor() {
    this.targetStatus = core.getInput("target-status");
    this.ignoreStatuses = core.getInput("ignore-statuses");

    if (!this.targetStatus) {
      throw new Error("Missing target status input");
    }

    if (this.ignoreStatuses) {
      this.ignoreStatuses = this.ignoreStatuses.split(/,\s*/);
    }

    this.jira = new Jira();
    this.github = new Github();
  }

  async run() {
    const commitMessages = await this.github.getPullRequestCommitMessages();
    const issueKeys = this.findIssueKeys(commitMessages);
    if (issueKeys.length === 0) {
      console.log(`Commit messages do not contain any issue keys`);
      return;
    }

    console.log(`Found issue keys: ${issueKeys.join(", ")}`);
    const issueList = await this.getIssueListFromKeys(issueKeys);
    const transitionIds = await this.getTransitionIds(issueList);
    await this.transitionIssues(issueList, transitionIds);
    await this.publishCommentWithIssues(issueList);
  }

  async publishCommentWithIssues(issueList) {
    if (issueList.length > 0) {
      const issueComment = issueList
        .map((issue) => {
          const summary = issue.fields.summary;
          const issueUrl = `${this.jira.getBaseUrl()}/browse/${issue.key})`;
          return `- ${summary} ([${issue.key}](${issueUrl})`;
        })
        .join("\n");
      const body = `These issues have been moved to *${this.targetStatus}*:\n` + issueComment;
      await this.github.publishComment(body);
    }
  }

  async getIssueListFromKeys(issueKeys) {
    const issuesData = await Promise.all(issueKeys.map((issueKey) => this.jira.getIssue(issueKey)));
    return issuesData.filter((issue) => {
      const status = issue.fields.status.name;
      return status !== this.targetStatus || !this.ignoreStatuses.includes(status);
    });
  }

  findIssueKeys(commitMessages) {
    const issueIdRegEx = /([a-zA-Z0-9]+-[0-9]+)/g;
    const matches = commitMessages.join(" ").match(issueIdRegEx);
    if (!matches) return [];
    return [...new Set(matches)];
  }

  async getTransitionIds(issues) {
    const transitionIds = await Promise.all(
      issues.map(async (issue) => {
        const { transitions } = await this.jira.getIssueTransitions(issue.key);
        console.log("Transitions: ", transitions);
        const targetTransition = transitions.find(({ name }) => name === this.targetStatus);
        if (!targetTransition) {
          console.log(`Cannot find transition to status "${this.targetStatus}"`);
          return null;
        }
        return targetTransition.id;
      })
    );

    return transitionIds.filter(Boolean);
  }

  async transitionIssues(issueList, transitionsIds) {
    for (let i = 0; i < issueList.length; i++) {
      const issueKey = issueList[i].key;
      const transitionId = transitionsIds[i];
      await this.jira.transitionIssue(issueKey, transitionId);
    }
  }
}

module.exports = App;
