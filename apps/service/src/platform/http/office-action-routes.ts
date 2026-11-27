import type { IncomingMessage } from "node:http";
import {
  createParamDecorator,
  HttpCode,
  HttpStatus,
  Req,
  RequestMapping,
  RequestMethod,
  type ExecutionContext,
} from "@nestjs/common";
import type { OfficeAction, OfficeActionMethod } from "@the-office/contracts";
import type { Request } from "express";
import { ContractPipe } from "./contract-pipe.js";
import { SignedIn } from "./signed-in-requests.js";

const METHODS: Readonly<Record<OfficeActionMethod, RequestMethod>> = {
  POST: RequestMethod.POST,
  PUT: RequestMethod.PUT,
  DELETE: RequestMethod.DELETE,
};

/** A request as Nest's HTTP adapter gives it: its path parameters and its parsed body. */
interface ActionRequest extends IncomingMessage {
  readonly params?: Record<string, string>;
  readonly body?: unknown;
}

/**
 * The action's input from its route: the path's parameters and the body together, parsed with its
 * schema as ContractPipe parses a body, so the handler only ever sees the contract's type.
 */
const OfficeActionInput = createParamDecorator(
  (action: OfficeAction, context: ExecutionContext): unknown => {
    const { params, body } = context.switchToHttp().getRequest<ActionRequest>();
    const fields = typeof body === "object" && body !== null ? body : {};
    return new ContractPipe(action.input).transform({ ...fields, ...params });
  },
);

/** The routes of a module's Office actions, its controller filling in `answer`. */
export abstract class OfficeActionRoutes {
  /**
   * Carries the action out for the signed-in user, answering what its route answers. `request` is
   * the request itself, for an action whose answer depends on the address the page was opened at.
   */
  abstract answer(
    action: OfficeAction,
    input: unknown,
    signedIn: SignedIn,
    request: Request,
  ): Promise<unknown>;
}

/**
 * The base of a module's controller of Office actions (the Office action convention): one route
 * per declared action, its method and path from the declaration, answering its status (200 unless
 * it declares 201, or 204 with no body) with what `answer` gives for its input, the signed-in user and
 * the request. The module's controller extends it under its own `@Controller()` and refusal filters.
 */
export function officeActionRoutes(
  actions: readonly OfficeAction[],
): abstract new () => OfficeActionRoutes {
  abstract class Routes extends OfficeActionRoutes {}
  for (const action of actions) {
    const route = function (
      this: Routes,
      input: unknown,
      signedIn: SignedIn,
      request: Request,
    ): Promise<unknown> {
      return this.answer(action, input, signedIn, request);
    };
    Object.defineProperty(Routes.prototype, action.name, {
      value: route,
      writable: true,
      configurable: true,
    });
    const descriptor = Object.getOwnPropertyDescriptor(Routes.prototype, action.name);
    if (descriptor === undefined) throw new Error(`No route was made for ${action.name}.`);
    RequestMapping({ path: action.route.path, method: METHODS[action.route.method] })(
      Routes.prototype,
      action.name,
      descriptor,
    );
    HttpCode(action.status ?? HttpStatus.OK)(Routes.prototype, action.name, descriptor);
    OfficeActionInput(action)(Routes.prototype, action.name, 0);
    SignedIn()(Routes.prototype, action.name, 1);
    Req()(Routes.prototype, action.name, 2);
  }
  return Routes;
}
