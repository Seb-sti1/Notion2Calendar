import {getTasksFromNotionDatabase, login, NotionClient, NotionObject} from "./notion";
import 'dotenv/config'
import {authorize, CalendarClient, CalendarObject, createEvent, listEvents, updateEvent} from "./calendar";

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

/**
 * Convert a NotionObject to a CalendarObject
 * @param t the object to convert
 */
function notionObjectToCalendarObject(t: NotionObject): CalendarObject {
    return {
        name: t.name,
        description: propertiesToEventDescription({
            Priority: t.priority,
            Deadline: t.deadline ? t.deadline.start.toISOString() : 'null',
            Category: t.category,
            Archived: t.archived ? "true" : "false",
            Id: t.id,
        }),
        date: t.date
    }
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
    const calendarEvents = await listEvents(gCalendar, process.env.CALENDAR_ID, numberOfDaysInPast)
    console.log(`${calendarEvents.length} tasks fetched from Google Calendar.`)

    // find element(s) missing in calendar
    const toCreate: CalendarObject[] = notionTasks
        .filter((task) => calendarEvents.find((e) => eventDescriptionToProperties(e.description).id === task.id) === undefined)
        .map((task) => notionObjectToCalendarObject(task))

    // send request for elements creation
    if (toCreate.length > 0) {
        console.log("The following events need to be created:", toCreate.map((e) => e.name).join('; '))
        await Promise.all(toCreate.map((e) => createEvent(gCalendar, process.env.CALENDAR_ID, e)))
    } else {
        console.log("No event needs to be created")
    }

    // find element(s) to delete
    const toDelete: CalendarObject[] = calendarEvents.filter((e) => notionTasks.find((t) => t.id === eventDescriptionToProperties(e.description).id) === undefined)
    // send request for elements deletion
    if (toDelete.length > 0) {
        // FIXME filter using start date whereas Calendar use end date
        console.log("The following events need to be deleted:", toDelete.map((e) => e.name).join('; '))
        // await Promise.all(toDelete.map((e) => deleteEvent(gCalendar, process.env.CALENDAR_ID, e.id)))
    } else {
        console.log("No event needs to be deleted")
    }

    // find elements that needs to be update in notion
    const toUpdateNotion: NotionObject[] = notionTasks
        .map((task) => {
            const event = calendarEvents.find((e) => eventDescriptionToProperties(e.description).id === task.id)
            // if the event doesn't exist or the update date is before the update date of the task, then
            // nothing to update related to this event in notion
            if (!event || event.lastEditedTime < task.lastEditedTime)
                return null

            if (task.date.start.getTime() !== event.date.start.getTime()
                || task.date.end?.getTime() !== event.date.end?.getTime()
                || task.date.isDateTime !== event.date.isDateTime) {
                return {
                    ...task,
                    date: event.date
                }
            }
            return null
        })
        .filter((t) => t !== null)
    // send request for elements update in notion
    if (toUpdateNotion.length > 0) {
        console.log("The following tasks need to be updated:", toUpdateNotion.map((t) => t.name).join('; '))
        // TODO update
    } else {
        console.log("No task needs to be updated")
    }

    // find elements that needs to be update in calendar
    const toUpdateCalendar: CalendarObject[] = calendarEvents
        .map((event) => {
            const task = notionTasks.find((t) => t.id === eventDescriptionToProperties(event.description).id)
            // if the task doesn't exist or the update date is after the update date of the task, then
            // nothing to update related to this event in notion
            if (!task || event.lastEditedTime > task.lastEditedTime)
                return null

            const taskToEvent = notionObjectToCalendarObject(task)
            if (event.description !== taskToEvent.description
                || event.date.start.getTime() !== taskToEvent.date.start.getTime()
                || event.date.end?.getTime() !== taskToEvent.date.end?.getTime()
                || event.date.isDateTime !== taskToEvent.date.isDateTime
                || event.name !== taskToEvent.name) {
                return {
                    id: event.id,
                    ...taskToEvent
                }
            }
            return null
        })
        .filter((t) => t !== null)
    // send request for elements update in calendar
    if (toUpdateCalendar.length > 0) {
        console.log("The following events need to be updated:", toUpdateCalendar.map((e) => e.name).join('; '))
        await Promise.all(toUpdateCalendar.map((e) => updateEvent(gCalendar, process.env.CALENDAR_ID, e)))
    } else {
        console.log("No event needs to be updated")
    }
}


login(process.env.NOTION_TOKEN)
    .then(async (notion) => ({notion, gCalendar: await authorize()}))
    .then(main)
    .catch(console.error)