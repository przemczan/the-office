-- A Project keeps the Repository URL it was cloned from; null for one added by its path.
ALTER TABLE "projects" ADD COLUMN "repository_url" text;
