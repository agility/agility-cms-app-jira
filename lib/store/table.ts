import { odata, TableClient, type TableEntity } from "@azure/data-tables"
import { DefaultAzureCredential } from "@azure/identity"

import type { Tokens } from "../core/adapter.ts"
import type { Connection, InstanceSetup, Link } from "../core/types.ts"
import { open, seal } from "./crypto.ts"
import { contentKey, type WorkStore } from "./store.ts"

/**
 * WorkStore on Azure Table Storage (resource group agility.apps.jira, Joel 2026-10-12). The App Service reaches it with
 * its managed identity (Storage Table Data Contributor): the storage account has shared-key access turned off, so there
 * is no connection string to leak. Locally, DefaultAzureCredential uses your `az login`.
 *
 * Tables, each row holding the record as JSON plus the columns it's queried by:
 *   workSetups       PK instanceGuid   RK provider      cols provider, siteId
 *   workConnections  PK "c"            RK id            cols instanceGuid, userId, provider, siteId
 *   workTokens       PK "t"            RK id            sealed Tokens (AES-256-GCM, WORK_TOKEN_KEY)
 *   workLinks        PK contentKey     RK id            cols provider, taskExternalId, instanceGuid
 *
 * The panel's hot path (a content item's links) is one partition read. Everything else is a filtered scan, which is fine
 * at hundreds of rows; revisit with index tables if an instance ever has tens of thousands of links.
 */

type Row = TableEntity<{ json: string; [k: string]: unknown }>

export interface TableStoreConfig {
	account: string
	/** Table name prefix, so several deployments can share an account (default "work"). */
	prefix?: string
}

export const createTableStore = (cfg: TableStoreConfig): WorkStore => {
	const credential = new DefaultAzureCredential()
	const url = `https://${cfg.account}.table.core.windows.net`
	const name = (t: string) => `${cfg.prefix ?? "work"}${t}`
	const clients = new Map<string, Promise<TableClient>>()

	// One client per table, created on first use (createTable is idempotent apart from the 409 it answers with).
	const table = (t: string) => {
		let c = clients.get(t)
		if (!c) {
			const client = new TableClient(url, name(t), credential)
			c = client.createTable().then(
				() => client,
				(e) => {
					if (e?.statusCode === 409) return client
					clients.delete(t)
					throw e
				}
			)
			clients.set(t, c)
		}
		return c
	}

	const get = async <T>(t: string, pk: string, rk: string): Promise<T | null> => {
		try {
			const row = await (await table(t)).getEntity<Row>(pk, rk)
			return JSON.parse(row.json) as T
		} catch (e: any) {
			if (e?.statusCode === 404) return null
			throw e
		}
	}
	const query = async <T>(t: string, filter: string): Promise<T[]> => {
		const out: T[] = []
		for await (const row of (await table(t)).listEntities<Row>({ queryOptions: { filter } })) out.push(JSON.parse(row.json) as T)
		return out
	}
	const put = async (t: string, entity: Row) => {
		await (await table(t)).upsertEntity(entity, "Replace")
	}
	const del = async (t: string, pk: string, rk: string) => {
		try {
			await (await table(t)).deleteEntity(pk, rk)
		} catch (e: any) {
			if (e?.statusCode !== 404) throw e
		}
	}

	return {
		getSetup: (guid, provider) => get<InstanceSetup>("Setups", guid, provider),
		findSetupsBySite: (provider, siteId) => query<InstanceSetup>("Setups", odata`provider eq ${provider} and siteId eq ${siteId}`),
		saveSetup: (s) => put("Setups", { partitionKey: s.instanceGuid, rowKey: s.provider, json: JSON.stringify(s), provider: s.provider, siteId: s.siteId }),
		deleteSetup: (guid, provider) => del("Setups", guid, provider),

		getConnection: async (guid, userId, provider) =>
			(await query<Connection>("Connections", odata`PartitionKey eq 'c' and instanceGuid eq ${guid} and userId eq ${userId} and provider eq ${provider}`))[0] ?? null,
		getConnectionById: (id) => get<Connection>("Connections", "c", id),
		findConnectionBySite: (provider, siteId) => query<Connection>("Connections", odata`PartitionKey eq 'c' and provider eq ${provider} and siteId eq ${siteId}`),
		saveConnection: async (c, tokens) => {
			await put("Connections", {
				partitionKey: "c",
				rowKey: c.id,
				json: JSON.stringify(c),
				instanceGuid: c.instanceGuid,
				userId: c.agilityUserId,
				provider: c.provider,
				siteId: c.siteId
			})
			await put("Tokens", { partitionKey: "t", rowKey: c.id, json: JSON.stringify(seal(JSON.stringify(tokens))) })
		},
		deleteConnection: async (id) => {
			await del("Tokens", "t", id)
			await del("Connections", "c", id)
		},

		getTokens: async (id) => {
			const sealed = await get<string>("Tokens", "t", id)
			return sealed ? (JSON.parse(open(sealed)) as Tokens) : null
		},
		saveTokens: (id, tokens) => put("Tokens", { partitionKey: "t", rowKey: id, json: JSON.stringify(seal(JSON.stringify(tokens))) }),

		listLinks: (content) => query<Link>("Links", odata`PartitionKey eq ${contentKey(content)}`),
		listLinksForTask: (provider, taskId) => query<Link>("Links", odata`provider eq ${provider} and taskExternalId eq ${taskId}`),
		listLinksForInstance: (guid) => query<Link>("Links", odata`instanceGuid eq ${guid}`),
		saveLink: (l) =>
			put("Links", {
				partitionKey: contentKey(l.content),
				rowKey: l.id,
				json: JSON.stringify(l),
				provider: l.provider,
				taskExternalId: l.taskExternalId,
				instanceGuid: l.content.instanceGuid
			}),
		deleteLink: async (id) => {
			// The id alone doesn't give the partition; find the row first (links are few per content item).
			for await (const row of (await table("Links")).listEntities<Row>({ queryOptions: { filter: odata`RowKey eq ${id}` } })) {
				await del("Links", row.partitionKey!, row.rowKey!)
			}
		}
	}
}

/** The Table store when AZURE_TABLE_ACCOUNT is set, else null. */
export const tableFromEnv = (env = process.env): WorkStore | null =>
	env.AZURE_TABLE_ACCOUNT ? createTableStore({ account: env.AZURE_TABLE_ACCOUNT, prefix: env.WORK_TABLE_PREFIX }) : null
