import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useMatchRoute, useNavigate, useParams } from "@tanstack/react-router";
import type { Role } from "@the-office/contracts";
import { Alert, Avatar, Button, EmptyState, Icon, Tabs } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { ApiError } from "../../api/api-client.ts";
import { hirePersonBack, roleQueries } from "../../api/people.ts";
import { useChat } from "../../shell/chat/use-chat.tsx";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { personName } from "../../shell/person-name.ts";
import { dayOf } from "../../shell/time.ts";
import { useToast } from "../../shell/toasts.tsx";
import { LetGoDialog } from "./let-go-dialog.tsx";
import { CAPABILITIES, taskLimitShort } from "../../shell/role-card-words.ts";
import "./people.css";

/** A person's page: who they are, their Tasks, their conversations and their Role card. */
export function PersonPage(): ReactNode {
  const { roleKey } = useParams({ from: "/people/$roleKey" });
  const role = useQuery(roleQueries.one(roleKey));
  usePageHeading({
    title: role.data?.card.name ?? "People",
    parent: { label: "People", to: "/people" },
    crumb: role.data && personName(role.data),
  });
  if (role.error) return <Missing error={role.error} />;
  if (!role.data) return null;
  return (
    <div className="person-page">
      <PersonHead role={role.data} />
      {role.data.letGoAt && (
        <Alert tone="neutral" title={`${role.data.card.name} was let go`}>
          Nobody fills the {role.data.card.title} Role. {role.data.card.name}'s Role card, Memory
          and chats are kept, unused and readable.
        </Alert>
      )}
      <PersonTabs roleKey={role.data.key} />
      <Outlet />
    </div>
  );
}

function PersonHead({ role }: { readonly role: Role }): ReactNode {
  const { card } = role;
  const editing = useMatchRoute()({
    to: "/people/$roleKey/role/edit",
    params: { roleKey: role.key },
  });
  const navigate = useNavigate();
  const chat = useChat();
  const [letting, setLetting] = useState(false);
  const letGo = role.letGoAt !== null;
  const queryClient = useQueryClient();
  const showToast = useToast();
  const hiringBack = useMutation({
    mutationFn: () => hirePersonBack(role.key),
    onSuccess: async (hiredBack) => {
      queryClient.setQueryData(roleQueries.one(hiredBack.key).queryKey, hiredBack);
      await queryClient.invalidateQueries(roleQueries.list());
      showToast(`${card.name} hired back.`);
    },
  });
  return (
    <header className="person-head">
      <Avatar name={card.name} size="lg" />
      <div className="person-head-grow">
        <h2>{personName(role)}</h2>
        <div className="person-head-meta">
          {CAPABILITIES.filter(({ key }) => card.capabilities[key]).map(({ key, label, icon }) => (
            <span key={key} className="person-chip">
              <Icon name={icon} size={12} />
              {label}
            </span>
          ))}
          <span className="person-chip">
            <Icon name="layers" size={12} />
            {taskLimitShort(card.taskLimit)}
          </span>
          {/* The Caretaker is never hired: it comes with The Office. */}
          {role.builtIn ? (
            <span className="person-chip">
              <Icon name="lock" size={12} />
              Built in
            </span>
          ) : (
            <span>· Hired {dayOf(role.hiredAt)}</span>
          )}
          {role.letGoAt && <span>· Let go {dayOf(role.letGoAt)}</span>}
        </div>
      </div>
      <div className="person-head-actions">
        {letGo ? (
          <Button
            iconLeft={<Icon name="user-plus" size={14} />}
            loading={hiringBack.isPending}
            onClick={() => hiringBack.mutate()}
          >
            Hire {card.name} back
          </Button>
        ) : (
          <>
            {card.capabilities.chat && (
              <Button
                iconLeft={<Icon name="message-circle" size={14} />}
                onClick={() => chat.open(role.key)}
              >
                Open the chat
              </Button>
            )}
            {editing === false && (
              <Button
                variant="secondary"
                iconLeft={<Icon name="pencil" size={14} />}
                onClick={() =>
                  void navigate({
                    to: "/people/$roleKey/role/edit",
                    params: { roleKey: role.key },
                  })
                }
              >
                Edit Role
              </Button>
            )}
            {!role.builtIn && (
              <Button
                variant="secondary"
                iconLeft={<Icon name="user-minus" size={14} />}
                onClick={() => setLetting(true)}
              >
                Let go
              </Button>
            )}
          </>
        )}
      </div>
      {letting && <LetGoDialog role={role} onClose={() => setLetting(false)} />}
    </header>
  );
}

const TABS = [
  { value: "overview", label: "Overview", to: "/people/$roleKey" },
  { value: "work", label: "Work", to: "/people/$roleKey/work" },
  { value: "conversations", label: "Conversations", to: "/people/$roleKey/conversations" },
  { value: "memory", label: "Memory", to: "/people/$roleKey/memory" },
  { value: "role", label: "Role card", to: "/people/$roleKey/role" },
] as const;

function PersonTabs({ roleKey }: { readonly roleKey: string }): ReactNode {
  const matchRoute = useMatchRoute();
  const navigate = useNavigate();
  // The Role card's tab stays chosen while its form is open.
  const shown =
    TABS.findLast(({ to }) => matchRoute({ to, params: { roleKey }, fuzzy: to !== TABS[0].to })) ??
    TABS[0];
  return (
    <Tabs
      tabs={TABS.map(({ value, label }) => ({ value, label }))}
      value={shown.value}
      onChange={(value) => {
        const tab = TABS.find((candidate) => candidate.value === value) ?? TABS[0];
        void navigate({ to: tab.to, params: { roleKey } });
      }}
    />
  );
}

function Missing({ error }: { readonly error: Error }): ReactNode {
  const gone = error instanceof ApiError && error.status === 404;
  return (
    <div className="person-page">
      <EmptyState
        icon={gone ? "user-x" : "circle-alert"}
        title={gone ? error.message : "The person can't be shown."}
        description={gone ? undefined : error.message}
        action={<Link to="/people">Back to People</Link>}
      />
    </div>
  );
}
