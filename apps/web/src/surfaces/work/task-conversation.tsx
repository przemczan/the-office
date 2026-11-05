import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  ENDED_TASK_CONVERSATION_WORDS,
  type ConversationTab,
  type Task,
  type Thread,
} from "@the-office/contracts";
import { Avatar, Button, Tabs } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { decisionQueries, threadQueries } from "../../api/conversations.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { roleQueries } from "../../api/people.ts";
import { DetailsSwitch } from "../../shell/conversation/details-switch.tsx";
import { roleFirstName, roleName } from "../../shell/person-name.ts";
import {
  CloseConversation,
  ConversationPanel,
  useConversationDrawer,
  useDrawerFollowsAddress,
} from "./conversation-drawer.tsx";
import {
  emptyThreadWords,
  firstTab,
  stagesWorkedOn,
  tabAsked,
  tabLine,
} from "./conversation-tabs.ts";
import { newMessagesWords, useNewMessages } from "./new-messages.ts";
import { TabFoot, TabLog } from "./person-tab.tsx";
import { useTimelineScroll } from "./use-timeline-scroll.ts";

/**
 * The Task's conversation: a tab per person, each holding that person's one Thread on the Task.
 * Stage Threads are read in the Stage history.
 */
export function TaskConversation({
  task,
  threads,
  asked,
}: {
  readonly task: Task;
  readonly threads: readonly Thread[] | undefined;
  /** What the address names, unless it is a Stage run. */
  readonly asked: string | undefined;
}): ReactNode {
  const tabs = useQuery(threadQueries.conversationOnTask(task.id)).data?.tabs;
  const decisions = useQuery(decisionQueries.unanswered(task.id)).data;
  const { decision: decisionId } = useSearch({ from: "/tasks/$taskId" });
  useDrawerFollowsAddress(
    decisions && tabs
      ? {
          threadId: asked,
          decisionId,
          decisionIsOpen: decisions.some(({ id }) => id === decisionId),
        }
      : undefined,
  );
  const [held, setHeld] = useState<string>();
  const askedTab = tabs && threads ? tabAsked(asked, tabs, threads) : undefined;
  const opening = held ?? (tabs && decisions ? firstTab(tabs, decisions) : undefined);
  // The first tab is chosen once: what happens later must not change the tab under the reader.
  const holding = askedTab ?? opening;
  if (holding !== held) setHeld(holding);
  const shown = tabs?.find(({ roleKey }) => roleKey === holding) ?? tabs?.[0];
  if (!tabs || !threads || !shown) return null;
  return <PeopleTabs task={task} threads={threads} tabs={tabs} shown={shown} />;
}

function PeopleTabs({
  task,
  threads,
  tabs,
  shown,
}: {
  readonly task: Task;
  readonly threads: readonly Thread[];
  readonly tabs: readonly ConversationTab[];
  readonly shown: ConversationTab;
}): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  const stages = useQuery(pipelineQueries.taskStages(task.id)).data?.stages;
  const navigate = useNavigate({ from: "/tasks/$taskId" });
  const { scroller, chapters, follows, follow } = useTimelineScroll(undefined);
  const drawer = useConversationDrawer();
  const outOfSight = drawer.narrow && !drawer.open;
  const { roleKey, threadId } = shown;
  const newMessages = useNewMessages(
    threadId === null ? [] : [threadId],
    (watched) => !outOfSight && follows(watched),
  );
  const personName = roleFirstName(roleKey, roles);
  const pick = (picked: string): void => {
    void navigate({
      search: (search) => ({ ...search, taskThread: picked }),
      replace: true,
      resetScroll: false,
    });
  };
  const workedOn = stagesWorkedOn(stages ?? [], threads, roleKey);
  const isPlanner = roleKey === tabs[0]?.roleKey;
  const readOnlyReason = ENDED_TASK_CONVERSATION_WORDS[task.state];
  return (
    <ConversationPanel unread={newMessages.count}>
      <div className="conversation-tabs">
        <Tabs
          tabs={tabs.map((tab) => ({
            value: tab.roleKey,
            label: <TabLabel name={roleFirstName(tab.roleKey, roles)} working={tab.stageRunning} />,
          }))}
          value={roleKey}
          onChange={pick}
        />
        <CloseConversation />
      </div>
      <header className="timeline-head">
        <div className="timeline-head-title">
          <h3>{roleName(roleKey, roles)}</h3>
          <p>{tabLine(isPlanner, shown, workedOn)}</p>
        </div>
        <DetailsSwitch />
      </header>
      <div className="timeline-view">
        <div className="timeline" ref={scroller}>
          <div className="timeline-chapters" ref={chapters}>
            <TabLog
              key={roleKey}
              task={task}
              tab={shown}
              personName={personName}
              emptyWords={emptyThreadWords(isPlanner, personName, workedOn)}
              readOnlyReason={readOnlyReason}
              onShown={follow}
            />
          </div>
        </div>
        {newMessages.threadId !== undefined && (
          <div className="timeline-new-messages">
            <Button size="sm" onClick={() => follow()}>
              {newMessagesWords(newMessages.count)}
            </Button>
          </div>
        )}
      </div>
      <TabFoot
        key={roleKey}
        task={task}
        tab={shown}
        personName={personName}
        personLabel={roleName(roleKey, roles)}
        readOnlyReason={readOnlyReason}
        onSent={() => follow()}
      />
    </ConversationPanel>
  );
}

function TabLabel({
  name,
  working,
}: {
  readonly name: string;
  readonly working: boolean;
}): ReactNode {
  return (
    <span className="conversation-tab">
      <Avatar name={name} size="xs" />
      {name}
      {working && (
        <span className="live-dot" title={`${name}'s Stage runs now`}>
          <span className="visually-hidden">, working now</span>
        </span>
      )}
    </span>
  );
}
