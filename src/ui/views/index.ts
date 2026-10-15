import type { App } from '../app';
import { homeView } from './home';
import { draftView } from './draft';
import { offseasonView } from './offseason';
import { gamesView, newsView, rosterView, standingsView } from './screens';
import { storylinesView } from './storylines';
import { recordsView } from './records';
import { busyView, modalView, pickerView, titleView, toastView } from './shell';
import { watchView } from './watch';
import { scoutingView } from './scouting';
import { deskView } from './desk';

export function view(app: App): string {
  let screen: string;
  if (app.screen === 'draft' && app.founding) screen = draftView(app, { league: app.founding.league, draft: app.founding.draft, userTeam: app.founding.team });
  else if (app.screen === 'draft' && app.game?.winter?.draft) screen = draftView(app, { league: app.game.league, draft: app.game.winter.draft, userTeam: app.game.userTeam });
  else if (app.screen === 'picker' && app.picker) screen = pickerView(app);
  else if (!app.game || app.screen === 'title') screen = titleView(app);
  else {
    switch (app.screen) {
      case 'watch': screen = app.watch ? watchView(app) : homeView(app); break;
      case 'standings': screen = standingsView(app); break;
      case 'games': screen = gamesView(app); break;
      case 'storylines': case 'leaders': case 'races': case 'gamelog': screen = storylinesView(app); break;
      case 'records': screen = recordsView(app); break;
      case 'scouting': screen = scoutingView(app); break;
      case 'desk': screen = deskView(app); break;
      case 'roster': screen = rosterView(app); break;
      case 'news': screen = newsView(app); break;
      case 'offseason': screen = app.game.offseason ? offseasonView(app) : homeView(app); break;
      default: screen = homeView(app);
    }
  }
  return screen + modalView(app) + busyView(app) + toastView(app);
}
