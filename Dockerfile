FROM node:17-slim

RUN apt-get update && apt-get install -qq -y git
COPY . action-transition-multiple-jira-issues
RUN cd action-transition-multiple-jira-issues && npm install && npm run build17
