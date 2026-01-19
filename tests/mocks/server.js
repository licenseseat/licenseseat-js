/**
 * MSW Server for Node.js test environment
 */

import { setupServer } from "msw/node";
import { handlers } from "./handlers.js";

// Create and export the server with the handlers
export const server = setupServer(...handlers);
