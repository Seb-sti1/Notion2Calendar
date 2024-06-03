import {calendar_v3, google} from 'googleapis';
import {DateRange} from "./notion";
import {CalendarClient} from "./google-auth";


export interface CalendarObject {
    id?: string,
    name: string,
    description: string,
    date: DateRange,
    lastEditedTime?: Date
}

/**
 * Lists the next 10 events on the user's primary calendar.
 * @param auth An authorized OAuth2 client.
 * @param calendarId the id of the calendar to use
 * @param numberOfDaysInPast all the events after today - numberOfDaysInPast days will be updated
 */
export async function listEvents(auth: CalendarClient, calendarId: string, numberOfDaysInPast: number): Promise<CalendarObject[]> {
    const calendar = google.calendar({version: 'v3', auth});
    let date = new Date()
    date.setDate(date.getDate() - numberOfDaysInPast)

    let events: CalendarObject[] = []

    let pageToken = null;
    let should_continue = true;
    while (should_continue) {
        const res = await calendar.events.list({
            calendarId: calendarId,
            timeMin: date.toISOString(),
            maxResults: 50,
            singleEvents: true,
            orderBy: 'startTime',
            pageToken: pageToken,
        });


        if (!res.data.items || res.data.items.length === 0) {
            return [];
        }

        res.data.items.map((event) => {
            const startDate = new Date(event.start.dateTime || event.start.date)
            let endDate = new Date(event.end.dateTime || event.end.date)

            // When using full day event, the end date is the "next" day
            // (e.g. for a full day event on the May 22nd, start.date = "22/05/2024", end.date = "23/05/2024")
            if (event.start.dateTime == null) {
                endDate.setDate(endDate.getDate() - 1)
            }

            events.push({
                id: event.id,
                name: event.summary,
                description: event.description,
                date: {
                    start: startDate,
                    end: (event.start.date != null && event.start.date === event.end.date) ? null : endDate,
                    isDateTime: event.start.dateTime != null
                },
                lastEditedTime: new Date(event.updated)
            })
        });
        pageToken = res.data.nextPageToken
        if (!pageToken) {
            should_continue = false
        }
    }

    return events
}

/**
 * Compute the date field when query Calendar API from a CalendarObject
 * @param event the event
 */
function getDateFields(event: CalendarObject): { dateField: string, startDate: string, endDate: string } {
    const startDate = event.date.isDateTime ? event.date.start.toISOString() : event.date.start.toISOString().split('T')[0]
    let endDate = event.date.end ? event.date.end : event.date.start

    // When using full day event, the end date is the "next" day
    // (e.g. for a full day event on the May 22nd, start.date = "22/05/2024", end.date = "23/05/2024")
    if (!event.date.isDateTime) {
        endDate.setDate(endDate.getDate() + 1)
    }

    return {
        dateField: event.date.isDateTime ? 'dateTime' : 'date',
        startDate: startDate,
        endDate: event.date.isDateTime ? endDate.toISOString() : endDate.toISOString().split('T')[0]
    }
}

/**
 * Create an event
 * @param auth An authorized OAuth2 client.
 * @param calendarId the id of the calendar to use
 * @param event the event to create
 */
export async function createEvent(auth: CalendarClient, calendarId: string, event: CalendarObject): Promise<boolean> {
    const calendar: calendar_v3.Calendar = google.calendar({version: 'v3', auth});
    const {dateField, startDate, endDate} = getDateFields(event)

    const request = await calendar.events.insert({
        calendarId: calendarId,
        requestBody:
            {
                summary: event.name,
                description: event.description,
                start: {[dateField]: startDate},
                end: {[dateField]: endDate}
            }
    });

    return request.status == 200
}

/**
 * Delete an event
 * @param auth An authorized OAuth2 client.
 * @param calendarId the id of the calendar to use
 * @param eventId the id of the event
 */
export async function deleteEvent(auth: CalendarClient, calendarId: string, eventId: string): Promise<boolean> {
    const calendar: calendar_v3.Calendar = google.calendar({version: 'v3', auth});

    const request = await calendar.events.delete({
        calendarId: calendarId,
        eventId: eventId
    });

    return request.status == 200
}

/**
 * Update an event
 * @param auth An authorized OAuth2 client.
 * @param calendarId the id of the calendar to use
 * @param event the event to update
 */
export async function updateEvent(auth: CalendarClient, calendarId: string, event: CalendarObject): Promise<boolean> {
    const calendar: calendar_v3.Calendar = google.calendar({version: 'v3', auth})
    const {dateField, startDate, endDate} = getDateFields(event)

    const request = await calendar.events.update({
        calendarId: calendarId,
        eventId: event.id,
        requestBody:
            {
                summary: event.name,
                description: event.description,
                start: {[dateField]: startDate},
                end: {[dateField]: endDate}
            }
    });

    return request.status == 200
}