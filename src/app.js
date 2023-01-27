const core = require("@actions/core");
const Jira = require("./jira");
const Github = require("./github");

class App {
  constructor() {
    this.targetStatus = core.getInput("target-status");
    if (!this.targetStatus) {
      throw new Error("Missing target status input");
    }

    this.isssuePrefixes = core.getInput("issue-prefixes");
    if (!this.isssuePrefixes) {
      throw new Error("Missing issue prefixes input");
    }
    this.isssuePrefixes = this.isssuePrefixes.split(/,\s*/);

    this.fromPush = core.getInput('from-push');
    this.ignoreStatuses = core.getInput("ignore-statuses");
    this.ignoreStatuses = this.ignoreStatuses ? this.ignoreStatuses.split(/,\s*/) : [];
    this.ignoreStatuses.push(this.targetStatus);

    this.ignoreIssueTypes = core.getInput("ignore-issue-types");
    this.ignoreIssueTypes = this.ignoreIssueTypes ? this.ignoreIssueTypes.split(/,\s*/) : [];

    this.jira = new Jira();
    this.github = new Github();
  }

  async run() {
    let commitMessages;
    if (this.fromPush) {
      commitMessages = this.github.getPushCommitMessages();
    } else {
      commitMessages = await this.github.getPullRequestCommitMessages();
      // treat PR title as a commit message, so that it will be scanned for ticket numbers
      commitMessages = [...commitMessages, this.github.getPullRequestTitle()];
    }
    const issueKeys = this.findIssueKeys(commitMessages);
    if (issueKeys.length === 0) {
      console.log(`Commit messages do not contain any issue keys`);
      return;
    }

    console.log(`Found issue keys: ${issueKeys.join(", ")}`);
    const issueList = await this.getIssueListFromKeys(issueKeys);
    const transitionIds = await this.getTransitionIds(issueList);
    await this.transitionIssues(issueList, transitionIds);
  }

  async getIssueListFromKeys(issueKeys) {
    const issuesData = await Promise.all(issueKeys.map((issueKey) => this.jira.getIssue(issueKey)));
    return issuesData.filter((issue) => {
      const status = issue.fields.status.name;
      const issueType = issue.fields.issuetype.name;
      return !this.ignoreStatuses.includes(status) && !this.ignoreIssueTypes.includes(issueType);
    });
  }

  findIssueKeys(commitMessages) {
    const issueIdRegEx = /([a-zA-Z0-9]+-[0-9]+)/g;
    const matches = commitMessages.join(" ").match(issueIdRegEx);
    if (!matches) return [];
    const issueKeys = [...new Set(matches)];
    return issueKeys.filter((key) => {
      const prefix = key.substr(0, key.indexOf("-"));
      return this.isssuePrefixes.includes(prefix);
    });
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
