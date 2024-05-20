import {Client} from "@notionhq/client"
import {
    PageObjectResponse,
    PropertyItemListResponse,
    PropertyItemObjectResponse
} from "@notionhq/client/build/src/api-endpoints";

export type NotionClient = Client

export type Priorities = "Highest" | "High" | "Medium" | "Low" | "Lowest"
export type Status = "Doing" | "Todo" | "Pending" | "On hold"
export type Categories = "Projects" | "Studies" | "Administratif"

export interface DateRange {
    start: Date,
    end: Date | null,
    isDateTime: boolean
}

export interface NotionObject {
    id: string,
    name: string,
    priority: Priorities,
    status: Status,
    category: Categories,
    date: DateRange | null,
    deadline: DateRange | null,
    archived: boolean,
    lastEditedTime: Date
}


/**
 * Login into notion
 * @param token the auth token
 */
export async function login(token: string) {
    if (token === "" || token == null) {
        throw new Error("The token must be not empty.")
    }
    return new Client({
        auth: token,
    })
}

/**
 * Get all object in the database
 * @param notion the api object
 * @param databaseId the database id to query
 * @param numberOfDaysInPast all the object after `today - numberOfDaysInPast days` will be queried
 */
export async function getTasksFromNotionDatabase(notion: Client, databaseId: string, numberOfDaysInPast: number): Promise<NotionObject[]> {
    let date = new Date()
    date.setDate(date.getDate() - numberOfDaysInPast)
    let cursor = undefined

    const tasks: NotionObject[] = []
    const shouldContinue = true
    while (shouldContinue) {
        const {results, next_cursor} = await notion.databases.query({
            database_id: databaseId,
            start_cursor: cursor,
            filter: {
                property: "Date",
                date: {
                    after: date.toISOString(),
                }
            },
        })
        for (const result of results) {
            if (result.object == "page" && "properties" in result) {
                tasks.push({
                    id: result.id,
                    name: await getOrFetchPropertyValue(result, "Nom", notion) as string,
                    priority: await getOrFetchPropertyValue(result, "Priority", notion) as Priorities,
                    category: await getOrFetchPropertyValue(result, "Category", notion) as Categories,
                    status: await getOrFetchPropertyValue(result, "Status", notion) as Status,
                    archived: await getOrFetchPropertyValue(result, "Archived", notion) as boolean,
                    date: await getOrFetchPropertyValue(result, "Date", notion) as DateRange,
                    deadline: await getOrFetchPropertyValue(result, "Deadline", notion) as DateRange,
                    lastEditedTime: new Date(result.last_edited_time)
                });
            } else {
                throw TypeError(`${result.id} is not a PageObjectResponse, it is a ${result.object == 'page' ? 'PartialPageObjectResponse' : 'PartialDatabaseObjectResponse | DatabaseObjectResponse'}`);
            }
        }
        if (!next_cursor) {
            break
        }
        cursor = next_cursor
    }

    return tasks
}


const TYPE_TO_VALUE = {
    "title": (p: PropertyItemListResponse) => p["plain_text"],
    "select": (p: PropertyItemListResponse) => p["name"],
    "date": (p: PropertyItemListResponse): undefined | DateRange =>
        p["start"] == null ? undefined : {
            start: new Date(p["start"]),
            end: p["end"] == null ? null : new Date(p["end"]),
            isDateTime: !/^\d\d\d\d-\d\d-\d\d$/.test(p["start"])
        },
    "checkbox": (p: PropertyItemListResponse) => p
}

/**
 * Get a property given the name
 * @param page the page object
 * @param name the name of the property to get
 * @param notion the api
 */
async function getOrFetchPropertyValue(page: PageObjectResponse,
                                       name: string,
                                       notion: Client): Promise<string | boolean | DateRange | null> {
    const pageId = page.id
    let property: PropertyItemObjectResponse = toPropertyItemObjectResponse(page.properties[name])[0]

    if (property[property.type] != null && TYPE_TO_VALUE[property.type](property[property.type]) == undefined) {
        console.debug("Fetching the property use API.")
        let propertyItem: PropertyItemObjectResponse | PropertyItemListResponse = await notion.pages.properties.retrieve({
            page_id: pageId,
            property_id: property.id,
        })
        property = (propertyItem.object === "property_item") ? propertyItem : propertyItem.results[0]
    }

    return property[property.type] == null ? null : TYPE_TO_VALUE[property.type](property[property.type])
}

/**
 * This is intended to convert a property from the page.properties to a PropertyItemObjectResponse
 * @param property an element of page.properties
 * @return the element converted to a PropertyItemObjectResponse
 */
function toPropertyItemObjectResponse(property: any): PropertyItemObjectResponse[] {
    if (["title", "rich_text", "people", "relation"].includes(property.type)) {
        const otherProperty = {...property};
        delete otherProperty[property.type]

        return property[property.type].map((e: any) => {
            return {
                object: 'property_item',
                [property.type]: e,
                ...otherProperty
            }
        })
    } else if (property.type === "rollup") {
        return undefined
    } else {
        return [{object: 'property_item', ...property}]
    }
}