import type { AvailableProject } from "../core/api";
import type { MediaServer } from "../node/media-server";
import { loadProject } from "../node/store";
import type { ProjectRequestContext } from "./app";
import { createBus, type EventBus, watchProject } from "./events";
import { createExportJobs } from "./export-jobs";
import { listAvailableProjects, resolveAvailableProject } from "./projects";

type Session = ProjectRequestContext & {
  watcher: Awaited<ReturnType<typeof watchProject>> | null;
  watcherPromise: Promise<void> | null;
  clients: number;
  pruneTimer: NodeJS.Timeout | null;
};

/** Project contexts are keyed by explicit IDs; the server never has a mutable current project. */
export class ProjectSessions {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly media: MediaServer) {}

  list(): Promise<AvailableProject[]> {
    return listAvailableProjects();
  }

  async get(id: string): Promise<ProjectRequestContext> {
    const project = await resolveAvailableProject(id);
    let session = this.sessions.get(id);
    if (!session || session.dir !== project.dir) {
      if (session) this.dispose(session);
      const bus: EventBus = createBus();
      session = {
        id: project.id,
        dir: project.dir,
        bus,
        register: (absPath) => this.media.register(absPath, project.id),
        exports: createExportJobs(project.dir, bus),
        watcher: null,
        watcherPromise: null,
        clients: 0,
        pruneTimer: null,
      };
      this.sessions.set(id, session);
    }
    if (session.pruneTimer) {
      clearTimeout(session.pruneTimer);
      session.pruneTimer = null;
    }
    return session;
  }

  async watch(id: string): Promise<() => void> {
    const session = (await this.get(id)) as Session;
    if (!session.watcher && !session.watcherPromise) {
      session.watcherPromise = watchProject(session.dir, session.bus)
        .then((watcher) => {
          session.watcher = watcher;
        })
        .finally(() => {
          session.watcherPromise = null;
        });
    }
    await session.watcherPromise;
    session.clients += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      session.clients = Math.max(0, session.clients - 1);
      if (session.clients === 0) this.schedulePrune(session);
    };
  }

  async close(): Promise<void> {
    for (const session of this.sessions.values()) this.dispose(session);
    this.sessions.clear();
  }

  private schedulePrune(session: Session) {
    session.pruneTimer = setTimeout(() => {
      session.pruneTimer = null;
      if (session.clients > 0) return;
      if (session.exports.running()) return this.schedulePrune(session);
      if (session.watcher) {
        session.watcher.close();
        session.watcher = null;
      }
      if (this.sessions.get(session.id) === session) this.sessions.delete(session.id);
    }, 5_000);
    session.pruneTimer.unref();
  }

  private dispose(session: Session) {
    if (session.pruneTimer) clearTimeout(session.pruneTimer);
    session.watcher?.close();
  }
}
