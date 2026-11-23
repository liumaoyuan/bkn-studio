/**
 * Copyright (c) 2026 OpenBKN
 * SPDX-License-Identifier: LicenseRef-OpenBKN
 * Licensed under the OpenBKN License, a modified Apache 2.0 with Additional
 * Conditions. See LICENSE for the full text.
 */

export interface MysqlConnectionInput {
  databaseName: string;
  host: string;
  password: string;
  port: number | string;
  username: string;
}

export const DEFAULT_MYSQL_PORT = 3306;
export const DEFAULT_CONTROL_DATABASE_NAME = "openbkn_data_ingestion";

function splitMysqlEndpoint(hostValue: string, portValue: number | string) {
  const value = hostValue.trim();
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(value);
  if (bracketed) {
    return {
      host: bracketed[1],
      port: bracketed[2] ? parseMysqlPort(bracketed[2]) : parseMysqlPort(portValue),
    };
  }

  const separator = value.lastIndexOf(":");
  if (separator > 0) {
    const address = value.slice(0, separator);
    const possiblePort = value.slice(separator + 1);
    if (!address.includes(":") && /^\d+$/.test(possiblePort)) {
      return {
        host: address,
        port: parseMysqlPort(possiblePort),
      };
    }
  }

  return {
    host: value,
    port: parseMysqlPort(portValue),
  };
}

export function normalizeMysqlHost(value: string): string {
  const host = value.trim();
  if (host.startsWith("[") && host.endsWith("]")) {
    return host.slice(1, -1);
  }
  return host;
}

export function formatMysqlHost(value: string): string {
  const host = normalizeMysqlHost(value);
  return host.includes(":") ? `[${host}]` : host;
}

export function parseMysqlPort(value: number | string | null | undefined): number {
  const port = Number(value ?? DEFAULT_MYSQL_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid database port");
  }
  return port;
}

export function buildMysqlConnectionUrl(input: MysqlConnectionInput): string {
  const endpoint = splitMysqlEndpoint(input.host, input.port);
  const host = formatMysqlHost(endpoint.host);
  const databaseName = input.databaseName.trim();
  const username = input.username.trim();

  if (!host) {
    throw new Error("Database host is required");
  }
  if (!databaseName) {
    throw new Error("Database name is required");
  }
  if (!username) {
    throw new Error("Database username is required");
  }

  return [
    `mysql+pymysql://${encodeURIComponent(username)}:${encodeURIComponent(input.password)}@`,
    `${host}:${endpoint.port}/${encodeURIComponent(databaseName)}?charset=utf8mb4`,
  ].join("");
}

export function createDataSpaceSlug(
  name: string,
  databaseName: string,
  suffix = Date.now().toString(36),
): string {
  const readable = (name || databaseName)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return `${readable || "space"}-${suffix}`.slice(0, 64);
}
