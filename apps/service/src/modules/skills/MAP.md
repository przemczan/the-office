# Skills: module map

**Owns:** the skill library (`skills`, `skill_versions`): uploads, skills written in place and skills installed from a Source at a pinned version (`SkillLibrary.install`; `SkillSources` reads what a Source holds), off until reviewed, "everyone"; its updates (`SkillUpdates`): the daily check that marks an installed skill "Update available" (on the platform's `Schedule`, first run at start), an update's draft and diff (`GET /skills/:name/update-diff`, git's diff between the two pinned versions), and applying one, which keeps the skill on or off and is refused when stale; Role skills (`role_skills`, `role_skill_changes`, each change with the user who made it, `changed_by`, from the Role card's save or Settings › Skills; records from before users existed are jsonb null until the first user claims them, `SkillsEarlierRecords` on the platform's `EarlierRecords`); Project skills, found in the checkout, each with the `key` the engine matches and the Project turns it off by (the Projects module keeps which are off; `sessionSkillRecord` splits what it finds by that); each session's plugin folder (`SessionSkills`, `session_skills`), in `<office-data>/sessions/<session id>/skills/`; `forget` and `sweep` remove the session's whole folder, with what an engine keeps there to resume it (the OpenAI-compatible API's `conversation.json`); each record keeps the session's Project (`projectId`, from `SessionProject.id`). Skills only the user runs, as skill commands (`disable-model-invocation: true`, `isUserOnly` in `skill-md.ts`): `PreparedSkills.userOnly` names them by their listed names (`userOnlySkillNames`), a library skill's read from its SKILL.md as the folder is written, a top-level Project skill's or command's kept on its record (`ProjectSkillName.userOnly`), and `expected` leaves them out, as the model's listing does; they stay allowed, and Review warns that only the user runs one. Skill uses (`SkillUses`, `skill_uses`, spec §2.6): each Engine `SkillCalled` (a Skill call, or a skill command the user sent) is resolved against the session's record (`usedSkillOf`: `office:<name>` a library skill it got, else a Project skill by its key or the name it is listed as, else a bare library name) and kept as one use of a library skill by name (taken along when the skill is removed, and none kept for one removed meanwhile) or of a Project skill by Project and key, then announced as `SkillUsed` (`skill.used`); `GET /skills` and `GET /projects/:id/skills` (`ProjectSkills.of(projectId, folder)`) give each its `usesInLast7Days`, a rolling window (`skillUseWindowStart`), and uses older than 7 days are pruned daily (`SKILL_USE_PRUNE` on the platform's `Schedule`, first run at start). The skill commands a Thread offers (`SkillCommands`, spec §2.4): `ofSession` a session's recorded library skills, `forRole` what a new session of the Role would get (`librarySkillsFor`, as `prepare`), each with the library's description now, never a Project skill; Conversations' HTTP adapter leaves out a name an Office command takes.

**Talks to:** the Engine's `SkillCalled` event, which it counts uses by, its only dependency on another module; People, Projects and Conversations call it (Conversations' `ThreadContexts` and `ThreadRunner` read `SkillCommands`, `SkillInstallProposals` and `SkillOfficeTools` install from a Source). The Engine takes the folder it builds and never reads Skills. Sources' git repositories, over the network, through `SourceFetcher`, each git command on the Office identity (`GitIdentityModule`; the Source's URL resolved by `ls-remote --get-url` first, since the user's `insteadOf` may turn https into ssh) (`git ls-remote`, a one-commit fetch into a temp bare repository, read from git's objects without a checkout).

**Traps:** a use is counted only once the session's record resolves the name: a name none of the session's skills answers to (an engine's built-in, a plugin's) is dropped, as is a call of a session with no record (forgotten already). The prune removes every use up to its time on the database every test file shares, so a test that runs it (`runDaily(SKILL_USE_PRUNE)`) or stores uses in the past sets its clock and its uses in a year no other file reaches (2002, 2003). A Project skill's key is not its listed name, and two rows of `GET /projects/:id/skills` can share one (`deploy` at the top and under `apps/web`): the engine takes them for one skill. A skill on and for everyone reaches every session prepared on the shared test database, so no test stores one; `application/session-skills.test.ts` makes its own for everyone in its app alone (`everyoneHere`, [testing](../../../docs/testing.md)). `SessionSkills.prepare` leaves out a skill the library no longer lists once its files are read (removed meanwhile), but fails the session on a listed skill with no files (`SkillVersionNotKept`). Tests never reach a real Source: they use local bare repositories (`adapters/git/source-repository.fixtures.ts`). A Source's repository comes from a model's Proposal, so `sourceRepositoryProblems` admits only https, ssh, `git@` and file URLs and `GitSourceFetcher` pins git's transports and never lets it prompt. The update check reads every installed skill's Source: a Source it can't read is logged and skipped, never an error; a test that runs it reads only its own Sources (`ownSources`, [testing](../../../docs/testing.md)).

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

SessionSkills, PreparedSkills, SessionProject, SessionSkillRequest, SkillCommands, SkillCommand, ProjectSkills, RoleSkills, RoleSkillsChange, SkillLibrary, SkillSources, SkillInstall, SourceSkill, SourceSkills, SKILL_UPDATE_CHECK, SkillUpdates, AppliedUpdate, SkillUpdateDraft, PinnedVersion, ProposedUpdate, SkillUpdateDiff, SkillRefused, RoleSkillsChanged, SkillAdded, SkillEveryoneChanged, SkillRemoved, SkillTurnedOff, SkillTurnedOn, SkillUpdateFound, SkillUpdateGone, SkillUpdated, SkillUsed, SkillVersionSaved, SkillsModule

## Domain events

- `domain/skill-events.ts`: SkillAdded, SkillVersionSaved, SkillUpdateFound, SkillUpdateGone, SkillUpdated, SkillTurnedOn, SkillTurnedOff, SkillEveryoneChanged, SkillRemoved, RoleSkillsChanged, SkillUsed

## HTTP routes (under `/api`)

- `GET /skills`: SkillsController.list
- `POST /skills`: SkillsController.write
- `POST /skills/uploads`: SkillsController.upload
- `GET /skills/:name`: SkillsController.read
- `GET /skills/:name/update-diff`: SkillsController.updateDiff
- `GET /skills/:name/review`: SkillsController.review
- `PUT /skills/:name`: SkillsController.edit
- `POST /skills/:name/versions`: SkillsController.uploadVersion
- `PUT /skills/:name/state`: SkillsController.changeState
- `PUT /skills/:name/everyone`: SkillsController.changeEveryone
- `PUT /skills/:name/roles`: SkillsController.assign
- `DELETE /skills/:name`: SkillsController.remove

## Tables

- `adapters/postgres/skills.schema.ts`: skills, skill_versions, session_skills, skill_uses, role_skills, role_skill_changes

## Files

### ./

- `index.fixtures.ts`: ownSources
- `skills.module.ts`: SkillsModule

### adapters/filesystem/

- `filesystem-library-folder.ts`: FilesystemLibraryFolder
- `filesystem-session-folders.ts`: FilesystemSessionFolders
- `skill-file-folders.ts`: UNFINISHED, writeWhole, writeSkillFiles, readSkillFiles, namesIn, exists
- Tests: filesystem-library-folder.full.test.ts, filesystem-library-folder.test.ts, filesystem-session-folders.full.test.ts, filesystem-session-folders.test.ts

### adapters/git/

- `git-project-skill-files.ts`: GitProjectSkillFiles
- `git-source-fetcher.fixtures.ts`: OwnSourcesFetcher, ownSources
- `git-source-fetcher.ts`: GitSourceFetcher
- `project-checkout.fixtures.ts`: ProjectCheckout, createProjectCheckout, projectSkillMd
- `source-repository.fixtures.ts`: SourceRepository, createSourceRepository, sourceSkillMd
- Tests: git-project-skill-files.full.test.ts, git-source-fetcher.full.test.ts

### adapters/http/

- `skill-refusals.filter.ts`: SkillRefusalsFilter
- `skills.controller.fixtures.ts`: aName, reasonsOf, skillMd
- `skills.controller.ts`: SkillsController
- Tests: skills.controller.full.test.ts, skills.controller.test.ts

### adapters/postgres/

- `everyone-here.fixtures.ts`: EveryoneHereSkillRepository, everyoneHere
- `postgres-role-skill-repository.ts`: PostgresRoleSkillRepository
- `postgres-session-skill-repository.fixtures.ts`: aRecord
- `postgres-session-skill-repository.ts`: PostgresSessionSkillRepository
- `postgres-skill-repository.ts`: PostgresSkillRepository
- `postgres-skill-use-repository.fixtures.ts`: aUse, aProjectOfItsOwn
- `postgres-skill-use-repository.ts`: PostgresSkillUseRepository
- `skills-earlier-records.ts`: SkillsEarlierRecords
- `skills.schema.ts`: skills, skillVersions, sessionSkills, skillUses, roleSkills, roleSkillChanges
- Tests: postgres-role-skill-repository.full.test.ts, postgres-role-skill-repository.test.ts, postgres-session-skill-repository.full.test.ts, postgres-session-skill-repository.test.ts, postgres-skill-repository.full.test.ts, postgres-skill-repository.test.ts, postgres-skill-use-repository.full.test.ts, postgres-skill-use-repository.test.ts, skills-earlier-records.test.ts

### adapters/websocket/

- `skill-web-events.ts`: SkillWebEvents

### adapters/zip/

- `yauzl-zip-reader.ts`: YauzlZipReader
- `zip.fixtures.ts`: ZipFixtureEntry, aZip, madeOnWindows
- Tests: yauzl-zip-reader.full.test.ts

### application/

- `project-skills.ts`: CountedProjectSkill, ProjectSkills
- `role-skills.ts`: RoleSkillsChange, RoleSkills
- `session-skills.ts`: PreparedSkills, SessionProject, SessionSkillRequest, SessionSkills
- `skill-commands.ts`: SkillCommand, SkillCommands
- `skill-library.ts`: Upload, ReviewedSkill, SkillLibrary
- `skill-sources.ts`: SkillInstall, SourceSkill, SourceSkills, SkillSources
- `skill-updates.ts`: SKILL_UPDATE_CHECK, SkillUpdateDraft, AppliedUpdate, SkillUpdates
- `skill-uses.ts`: SKILL_USE_PRUNE, SkillUses
- Tests: session-skills.test.ts, skill-commands.test.ts, skill-library.full.test.ts, skill-updates.full.test.ts, skill-uses.full.test.ts

### domain/

- `installed-source.ts`: PinnedVersion, InstalledSource, RemoteRef, sourceRepositoryProblems, sourceUrl, sourceFolderProblem, fallbackNameOf, pinnedVersionOf, pinnedVersionLabel, isUpdateOf, samePinnedVersion, compareTags
- `project-skills.ts`: ProjectSkill, projectSkillsFrom
- `role-skills.ts`: RoleSkillAssignment, RoleSkillsChange, AssignmentsChange, withRoleSkills, withSkillRoles, assignmentsChange, skillsOfRole, rolesOfSkill, assignedSkillsProblems
- `session-skills-not-found.ts`: SessionSkillsNotFound
- `session-skills.ts`: SESSION_PLUGIN, SessionSkill, ProjectSkillName, ProjectSkillFile, projectSkillNamesFrom, projectSkillNameOf, SessionSkillRecord, librarySkillsFor, ProjectSkillUse, sessionSkillRecord, allowedSkillNames, expectedSkillNames, userOnlySkillNames, suffixMatches, skillOverridesOf
- `skill-changes.ts`: SkillChange, addSkill, saveVersion, noteSourceVersion, applyUpdate, turnOn, turnOff, changeEveryone, removeSkill
- `skill-draft.ts`: SkillDraft, WrittenSkill, writtenDraft, writtenSkillProblems, uploadedDraft, checkSameSkill, skillMdOf, nameFromFileName
- `skill-events.ts`: SkillAdded, SkillVersionSaved, SkillUpdateFound, SkillUpdateGone, SkillUpdated, SkillTurnedOn, SkillTurnedOff, SkillEveryoneChanged, SkillRemoved, RoleSkillsChanged, SkillUsed
- `skill-files.ts`: SkillFile, SKILL_MD, isWindowsDeviceName, skillFilesHash, sortedByPath, skillFilePathProblem, skillFilesProblems
- `skill-md.ts`: SkillMd, readSkillMd, writtenSkillMd, frontmatterText, frontmatterFlag, isUserOnly
- `skill-not-found.ts`: SkillNotFound
- `skill-refused.ts`: SkillRefused
- `skill-review.ts`: ReviewedFile, SkillReview, reviewOf
- `skill-update.ts`: ProposedUpdate, SkillUpdateDiff, UPDATE_DIFF_BYTES, cutDiff, updateProblem, noUpdates
- `skill-upload.ts`: UPLOAD_LIMITS, uploadTooLarge, FolderEntry, uploadKind, uploadKindProblem, draftFromMd, draftFromZip, refuseLinksAndOthers
- `skill-uses.ts`: SKILL_USE_DAYS, UsedSkill, SkillUse, usedSkillOf, skillUseWindowStart
- `skill-version-missing.ts`: SkillVersionMissing, SkillVersionNotKept
- `skill-version.ts`: SkillVersion, currentVersionOf
- `skill.fixtures.ts`: aNewSkill, aSkill, aSkillFile
- `skill.ts`: SKILL_SOURCES, SkillSource, SKILL_STATES, SkillState, Skill, NewSkill, DESCRIPTION_LENGTH, LONG_DESCRIPTION_LENGTH, trimmedNewSkill, skillNameProblems, skillDescriptionProblems, longDescriptionWarning, newSkillProblems, skillNameTaken
- `source-skills.ts`: SourceFolder, SOURCE_FOLDER_LIMITS, sourceFolderTooLarge, installedDraft
- `user.fixtures.ts`: ANN_LEE, BEN_ITO
- `user.ts`: UserRef
- Tests: installed-source.full.test.ts, project-skills.full.test.ts, role-skills.full.test.ts, session-skills.full.test.ts, skill-changes.full.test.ts, skill-draft.full.test.ts, skill-files.full.test.ts, skill-files.test.ts, skill-md.full.test.ts, skill-review.full.test.ts, skill-update.full.test.ts, skill-upload.full.test.ts, skill-uses.full.test.ts, skill.full.test.ts, source-skills.full.test.ts

### ports/

- `library-folder.ts`: LibraryFolder
- `project-skill-files.ts`: ProjectSkillFiles
- `role-skill-repository.ts`: RoleSkillRepository
- `session-folders.ts`: SessionFolderSkill, SessionFolders
- `session-skill-repository.ts`: SessionSkillRepository
- `skill-repository.ts`: SkillUpdate, SkillRepository
- `skill-use-repository.ts`: SkillUseRepository
- `source-fetcher.ts`: SourceNotFetched, SourceRead, SourceDiffRead, SourceFetcher
- `zip-reader.ts`: ZipReader
