import {getTasksFromNotionDatabase, login, NotionClient} from "./notion";
import 'dotenv/config'
import {authorize, CalendarClient, CalendarObject, createEvent, listEvents} from "./calendar";

/**
 * Convert a description to a list of property.
 * It is the inverse of propertiesToEventDescription.
 * @param description the description to parse
 * @result the properties
 */
function eventDescriptionToProperties(description: string): { [key: string]: (string | boolean | null) } {
    let properties = {};

    description.split('\n').map((line) => {
        const k = line.split(':')[0]
        let v: (string | boolean | null) = line.replace(`${k}: `, '')
        if (v === "true") {
            v = true
        } else if (v === "false") {
            v = false
        } else if (v === "null") {
            v = null
        }

        if (k !== "")
            properties[k.toLowerCase()] = v
    })

    return properties
}

/**
 * Convert a list of properties to a description
 * It is the inverse of eventDescriptionToProperties.
 * @param properties the list of property
 * @result the description
 */
function propertiesToEventDescription(properties: { [key: string]: string }): string {
    let description = '';
    for (let property in properties) {
        description += property + ': ' + properties[property] + '\n'
    }
    return description;
}


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

    // find element(s) missing in calendar
    const toCreate: CalendarObject[] = notionTasks
        .filter((task) => gCalendarEvents.find((e) => eventDescriptionToProperties(e.description).id === task.id) == undefined)
        .map((task) => ({
            name: task.name,
            description: propertiesToEventDescription({
                Priority: task.priority,
                Deadline: task.deadline ? task.deadline.start.toISOString() : 'null',
                Category: task.category,
                Archived: task.archived ? "true" : "false",
                Id: task.id,
            }),
            date: task.date
        }))

    // send request for elements creation
    if (toCreate.length > 0) {
        console.log("The following tasks need to be created:\n\t", toCreate.map((e) => e.name).join('; '))
        await Promise.all(toCreate.map((e) => createEvent(gCalendar, process.env.CALENDAR_ID, e)))
    } else {
        console.log("No task needs to be created")
    }

    // TODO find element(s) to delete
    const toDelete = []

    // TODO find modification
    // TODO find where to update (given the lastEditedTime)
    const toUpdateNotion = []
    const toUpdateCalendar = []
    // TODO update all elements
}


login(process.env.NOTION_TOKEN)
    .then(async (notion) => ({notion, gCalendar: await authorize()}))
    .then(main)
    .catch(console.error)