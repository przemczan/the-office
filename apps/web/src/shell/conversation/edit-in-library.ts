import { useNavigate } from "@tanstack/react-router";
import { useChatDrawerLayout } from "../chat/chat-drawer-width.ts";
import { useChat } from "../chat/use-chat.tsx";

/**
 * "Edit before applying" of a library Pipeline or Stage template Proposal: opens the Pipeline or
 * Stage template in Settings › Pipelines with the Proposal over it, so saving there applies it.
 * Below 901px the chat covers the page, so it closes.
 */
export function useEditInLibrary(): (
  action: string,
  input: Readonly<Record<string, unknown>>,
  proposalId: string,
) => void {
  const navigate = useNavigate();
  const chat = useChat();
  const { place } = useChatDrawerLayout();
  return (action, input, proposal) => {
    if (place !== "beside") chat.close();
    const search = { proposal };
    const { pipelineId, templateId } = input;
    if (action === "add_stage_template") {
      void navigate({ to: "/settings/pipelines/stage-templates", search });
    } else if (action === "change_stage_template" && typeof templateId === "string") {
      void navigate({
        to: "/settings/pipelines/stage-templates/$stageTemplateId",
        params: { stageTemplateId: templateId },
        search,
      });
    } else if (action === "change_library_pipeline" && typeof pipelineId === "string") {
      void navigate({
        to: "/settings/pipelines/$pipelineId",
        params: { pipelineId },
        search,
      });
    } else {
      void navigate({ to: "/settings/pipelines", search });
    }
  };
}
