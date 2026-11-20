# Decision card

Covers: the Decision card and its forms (the form in place, the compact card, the approval card, the Bug Task card, the answered card), the details window, Submit, Accept, Ask me again, Dismiss, comments, progress, drafts, where a card shows.

## Where it is

- On Now and in the Needs you panel ([now.md](now.md#needs-you), [shell.md](shell.md#needs-you-panel)), where it sits under the Task's title and Project chip with when it was asked in place of where.
- On the Task page's Needs you card ([task-page.md](task-page.md)), on an Initiative's page for a Decision on no Task ([initiative-page.md](initiative-page.md)).
- In a Thread's log ([thread.md](thread.md)): short while open, whole once answered; inline and whole in a person's chat.
- In a window (Open details), from the compact card or from a Mention of a waiting Decision in a chat.
- A link to a Decision (`?decision=<id>`, with `taskThread` or `initiativeThread`) brings its card into view and marks it (`aria-current`).
- The same Decision shows one draft wherever it shows.

## Layout

- A card (`section`) named "Decision: <first question>[ (and N more questions)]". Top line: a **Decision** badge (amber while open, gray once settled), who asks (the person's tag, or "The Office"), "to <Consultant>" while it is put to one, "· N questions" past one, where or when it was asked, and a link icon button "Copy link".
- Below: the card's body, one of the forms below.
- The card's `where` decides the form: Needs you (Now, the panel, the Task page), a Thread that answers it in place, or inline in a chat.

## Which form

- Answered, asked again or closed: the answered card.
- An approval (`kind` approval): the approval card, never a form.
- A Bug Task Decision (`kind` bug-task): the Bug Task card, compact in the shared feed.
- In the shared feed (Now and the Needs you panel), with 2 or more questions or any Attachment: the compact card.
- On the Task page's Needs you card and in Threads, past 3 questions or with any Attachment, outside an inline chat card: the compact card.
- Otherwise: the form in place. An inline chat card is always the whole form in place.
- Where a card shows is in [2.4.2](../2.4.2-decisions.md#where-a-decision-shows).

## The form in place

- Per question, a group named "Question N": the question as Markdown, numbered when there are several (the number turns to a check once answered).
- A choice (radio list, native radios): each option with a **Recommended** badge on the recommended one, and the last line **None of these: answer in words**. The recommended option is picked at first. Under the list: "<asker> recommends “<option>”: <reason>".
- With None of these picked, a required box **Your answer in words** (placeholder "None of the options: say what you want instead"), which is the answer; no comment link then.
- An open question: the label "Answered in words" and, when the asker gave why, "Why <asker> needs it: <why>"; a required box **Your answer** (placeholder "Your answer in words"; for a request "Say what you did, or why you can't").
- A request (`kind` request) has no question text of its own: the card's line reads "Asked <you|name> to: <the request>".
- Each answer's comment is folded behind **Add a comment** (plus icon) until opened or written, then a box **Comment** ("Optional.", placeholder "Anything to add to this answer"). An approval has none.
- Above the questions: the context as Markdown, and "<Name> passed it on: <reason>" lines for each Consultant that passed it on.
- In a Consultation: "Waiting on <name> in a Consultation. Take it over to answer here." with **Take it over** (secondary). The form is locked until it is pressed: options, comments, Submit, Ask me again, Accept and an approval's options wait, with "Take it over first." as the reason.
- **Take it over** only unlocks the form, wherever the Decision shows on the page; the line then reads "Waiting on <name> in a Consultation. Your answer here takes it over.", and the answer takes the Decision from the Consultant.
- After the questions: the **General comment** box ("Optional.", placeholder "Anything about the form as a whole").
- Actions: **Submit** (primary), **Ask me again** (secondary, rotate icon), **Dismiss** (secondary, circle-x icon, where [allowed](#dismiss)) and, with several questions, the progress line.
- Under the actions: why the form waits, the hints below, and the follow-up hint.

### Submit

- Submit sends each question's answer in order with its comment, a choice with no option as its comment's words, and the general comment when written.
- It is disabled, with the reason as its title, while: the asker is still answering ("<name> is still answering. Answer once they finish."); an answer is being sent ("Sending your answer…"); a question has no answer: "Pick an option or write your answer first." / "Write your answer first." (one question), "Answer question N in its words first." (a choice on None of these), "Answer question N first."
- A refusal shows "The answer wasn't sent" and the draft stays.
- Once sent the draft goes, the Thread takes the answer as the person's next message, and the card becomes the answered card.

### Ask me again

- Asks the person to explain or change; it is shown while the Decision has a person asking and isn't an approval.
- Pressing it replaces the actions with a step (section "Ask me again"): a box "What should <asker> explain or change?" ("Optional.", placeholder "Your general comment, sent alone"), the text "Sends this comment and no answers. Your picks stay here as a draft until you send; <asker> explains and asks again in a new form.", then **Ask me again** and **Cancel**.
- It sends the general comment alone; the picks stay in the draft.
- Disabled while the asker is still answering ("<name> is still answering. Ask again once they finish.") or an answer is sending.

### Dismiss

- Closes the Decision unanswered; shown beside Ask me again on the form in place, the compact card and the details window, only where the service allows it ([2.4.2](../2.4.2-decisions.md#sending-a-decision)): never on an approval, The Office's own Decisions, a Stage Thread's, one put to a Consultant, or one settled.
- Pressing it replaces the actions with a step (section "Dismiss"): a box "Why dismiss it?" ("Optional.", placeholder "Your general comment, sent with your next message"), the text "Closes the Decision unanswered. <asker> learns of it with your next message in the Thread.", then **Dismiss** and **Cancel**.
- Disabled while an answer is sending.

### Progress line

- "5 of 8 answered" with a bar, an untouched recommendation counting as answered; then "Ready to submit" or the link "Question N needs an answer", which jumps to (and focuses) the first unanswered question.

### Hints

- While the person answers: "<name> is still answering. Answer once they finish." and Submit, Ask me again and Accept wait.
- In an Initiative's planning Thread the card stays answerable and says "Reaches <name> when this turn ends."
- "A question first? Ask <name> in the Thread; the Decision stays open." (inline in a chat: "below"), shown where the user may write in the Thread (never in a Stage Thread, never for The Office).

## The compact card

- For a long form or one with Attachments: the context's first line; "Question 1 of N" (or "The question" for one), the question, the recommended option with a **Recommended** badge and "<asker> recommends it: <reason>" (or "Answered in words." for an open question).
- Notes: "N more questions, M of them open questions" and "N Attachments to look at in Open details" joined by " · ".
- Actions: **Accept** (check icon), **Open details**, **Dismiss** (where allowed), the badge "Draft kept · N changes" once the draft differs from the recommendations (a general comment counts as one), and the progress line (several questions).
- **Accept** shows only while every question is a choice and the draft is untouched; it sends every recommended option with no comments. It waits while the asker answers.
- **Open details** (primary when Accept isn't shown) opens the window; it is disabled with "Reading the Attachments…" while they load. The progress line's "Question N needs an answer" opens the window at that question.
- The hints and the follow-up hint show under the actions.

## The approval card

- For a call past a Hard switch ([6](../6-permissions-and-safety.md)): the question as Markdown, the context, the Consultation note, "<asker> recommends “<option>”: <reason>", and a group named "Options" with one button per option, the recommended one primary (such as **Allow once** and **Deny**).
- One click sends the answer; there is no comment, no Ask me again, no words.
- Disabled while the asker answers (title says why) or an answer is sending; a refusal shows "The answer wasn't sent".

## The Bug Task card

- For a Bug Task Decision ([2.4.2](../2.4.2-decisions.md#the-bug-task-decision)): under the top line, "<asker> proposes a Bug Task", then the Agent's why as the context.
- The proposed Task's fields, editable: **Title** (required), **Description**, **Project** (the Agent's Task's at first) and **Caused by** ("Optional.", a Task picker, "Find a Task by its title").
- The **General comment** ("Optional.", placeholder "Anything about the form as a whole").
- Actions: **Create the Bug Task** (waits with "Write a title first." while the title is empty), **Don't create it** and **Ask me again**, with the hint "It goes to Backlog as a Bug, found while working on this Task."
- Ask me again is a step asking "What should <asker> explain or change?", as on any form.
- No Dismiss, as on any Stage Thread's Decision.
- A Create that is refused keeps the card open with its refusal shown.
- In the shared feed (Now, the Needs you panel): the context's first line, "Bug Task: <title>" and **Open details**, which opens a Large window "<asker> proposes a Bug Task" with the same form and the three actions in its bar.
- Answered: "Created the Bug Task <Task>", linked with its state, or "Didn't create the Bug Task", then the outcome line and "General comment: …".

## The details window (Open details)

- A Large window, kept at one height when there are several questions, titled with the Decision badge, who asks and "· N questions". Its bar: **Submit** (closes the window once sent), **Ask me again** and, where allowed, **Dismiss**; each of the two is a step: the field, the button and **Cancel**.
- Closing keeps the draft and asks nothing first.
- With several questions: the progress line on top; the list "Questions" on the left, each row its number (check once answered), the question and its answer so far ("IndexedDB (recommended)", "In words: …", "Needs an answer in words", "Needs an answer"); on the right the context and Attachments, "Question N of M", the question, and **Previous** / **Next**; the last question shows **Submit** in Next's place (not while asking again). Under 900px the list is a row of numbers ("Questions by number", each "Question N", answered or missing) above the question.
- The fold at the top of the details reads **Context** or "Context and N Attachments", open at first, with the context, the passed-on lines, the Consultation note and the Attachment gallery (images open the viewer).
- With one question: the context and the question alone, scrolling.
- The general comment and the hints are at the window's foot.
- It opens at the question the progress line named, else the first.

## The answered card

- Read-only, where it was asked: the context's first line, then each question (numbered when several) with its answer (with "(recommended)" after the recommended option), "Comment: …", and "General comment: …".
- Past 3 questions it shows the first 3 and **Show all N**.
- The outcome line: "Answered" or "Answered by you" / "Answered by <user>"; "Answered by <person> at your request" (or "at <user>'s request") with a link to the Thread asked in; "Answered by <Consultant> in a Consultation" with **Open the Consultation**; "Answered by The Office[: <comment>]"; "Asked again[ by …]: <comment>" or "Asked again, with no comment" (its questions read "Not answered"); "Dismissed by you" / "Dismissed by you: <comment>" (or "by <user name>" for another user; its questions read "Not answered"); or the closed line. A Thread's short form shows the same.
- Closed: "Closed: the Task was dropped." or "Closed: the Initiative ended."
- A request reads "Asked <you|name> to: …" and no question list until answered.

## The Decision in a Thread

- While open and not answerable in the Thread: a short form: the first question (with "N questions, starting with: " past one), "Waits on you." (or "Waiting on <name> in a Consultation."), and the link **Answer it in Needs you** (or **Take it over in Needs you**), which opens the Task's page at the card; and **Open the Consultation** for one put to a Consultant.
- In an Initiative's Thread a Decision on a Task names it ("On <Task>"); one on no Task reads "On no Task: about the Initiative as a whole" and is answered in the Thread itself, the whole card (compact past the threshold), the card a link lands on.
- A Decision made from a chat has no Needs you link and no copy link; a request reads "Asked <name> to: …" with no options.
- One waiting on the user in a person's chat (not a Consultation) is the whole form inline, answered there, and waits while the person answers.

## States

- Open, answering, sending, answered, asked again and closed as above.
- Waiting: Submit, Accept, Ask me again and the options wait while the asker answers; a Decision put to a Consultant shows "Waiting on <name> in a Consultation."
- Error: "The answer wasn't sent".
- Narrow window: the window's question list becomes a row of numbers under 900px.
- Drafts: one per Decision, kept in the page's memory while it lives; kept on closing the window or after a refusal, cleared once sent.

## Domain facts

- The Decision form, sending, where a Decision shows, closing: [2.4.2](../2.4.2-decisions.md).
- Consultations: [2.4.3](../2.4.3-consultations.md).
- Hard switches and approvals: [6](../6-permissions-and-safety.md).
- Window sizes and the form's rules: [4.1](../4.1-ui-rules.md).
