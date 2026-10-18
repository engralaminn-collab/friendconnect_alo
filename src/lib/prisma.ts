import runtime from './db-runtime'

const client = (runtime as { prisma?: typeof runtime }).prisma || runtime

export const prisma = client
export const db = client
export default client
