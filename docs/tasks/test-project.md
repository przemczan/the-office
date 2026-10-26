# The Test Project

The real Project a task's check runs on.

`notnullsoft-admin` at `D:\Projects\notnullsoft-admin`, chosen by the user in task 04. Base branch `main`, remote `https://github.com/przemczan/notnullsoft-admin.git`; an npm workspace on Node 22 with `npm install`, `npm run build`, `npm run lint` and `npm test`. A push to its `main` deploys production (`.github/workflows/deploy-production.yml`), so a Publish check uses push + PR on a throwaway branch, never merge. It is never this repository or `D:\Projects\software-factory`.
