import { Module, type DynamicModule } from "@nestjs/common";
import { CookieSignedInRequests, UsersModule } from "./modules/users/index.js";
import { DatabaseModule } from "./platform/database/database.module.js";
import { EarlierRecordsModule } from "./platform/earlier-records/earlier-records.module.js";
import { EventsModule } from "./platform/events/events.module.js";
import { RequestAccessModule } from "./platform/http/request-access.module.js";
import { WebEventForwarding } from "./platform/websocket/web-event-forwarding.js";

/**
 * The database, events and the users module, with no HTTP: what a host command such as
 * `npm run set-password` or `npm run setup-token` needs. Starting it runs pending migrations, so
 * a command works before the service's first start.
 */
@Module({})
export class HostCommandModule {
  static register(databaseUrl: string): DynamicModule {
    // A host command needs no identity provider.
    const users = UsersModule.register({ imports: [], identityProviders: [] });
    return {
      module: HostCommandModule,
      // The users module maps its web events here; with no WebSocket, they go nowhere.
      global: true,
      providers: [WebEventForwarding],
      exports: [WebEventForwarding],
      imports: [
        DatabaseModule.forRoot({ url: databaseUrl }),
        EventsModule,
        // The first user's claims on earlier records, which no host command makes.
        EarlierRecordsModule,
        users,
        // The users module's controllers ask for the addresses, though no request reaches them here.
        RequestAccessModule.register({
          publicAddress: undefined,
          imports: [users],
          signedInRequests: CookieSignedInRequests,
        }),
      ],
    };
  }
}
