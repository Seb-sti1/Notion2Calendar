import {getTasksFromNotionDatabase, login} from "./notion";
import 'dotenv/config'

login(process.env.NOTION_TOKEN)
    .then((notion) => getTasksFromNotionDatabase(notion, process.env.NOTION_DATABASE_ID, 5))
    .then(console.log)
    .catch(console.error)