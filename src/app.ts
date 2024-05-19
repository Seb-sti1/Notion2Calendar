import {getTasksFromNotionDatabase, login, NotionClient} from "./notion";
import 'dotenv/config'
import {authorize, CalendarClient, listEvents} from "./calendar";


async function main({notion, gCalendar}: {
    notion: NotionClient,
    gCalendar: CalendarClient
}) {
    const numberOfDaysInPast = parseInt(process.env.NUMBER_OF_DAYS_IN_PAST)

    // fetch relevant notion tasks
    const notionTasks = await getTasksFromNotionDatabase(notion, process.env.NOTION_DATABASE_ID, numberOfDaysInPast)
    console.log(`${notionTasks.length} tasks fetched from Notion.`)

    // fetch relevant google calendar events
    const gCalendarEvents = await listEvents(gCalendar, process.env.CALENDAR_ID, numberOfDaysInPast)
    console.log(`${gCalendarEvents.length} tasks fetched from Google Calendar.`)

    // TODO figure out notionTasks/gCalendarEvents association
    // TODO find modification
    // TODO find where to update (given the lastEditedTime)
    // TODO update all elements
    console.debug("hey")

}


login(process.env.NOTION_TOKEN)
    .then(async (notion) => ({notion, gCalendar: await authorize()}))
    .then(main)
    .catch(console.error)