import { describe, expect, test } from "bun:test"
import { Binary } from "../src/binary"

describe("Binary.search", () => {
  test("finds existing items", () => {
    const items = ["a", "c", "f", "z"].map((id) => ({ id }))
    const result = Binary.search(items, "f", (item) => item.id)
    expect(result.found).toBe(true)
    expect(result.index).toBe(2)
  })

  test("returns insertion index when not found", () => {
    const items = ["a", "c", "f", "z"].map((id) => ({ id }))
    const result = Binary.search(items, "d", (item) => item.id)
    expect(result.found).toBe(false)
    expect(result.index).toBe(2)
  })

  test("handles empty arrays", () => {
    const result = Binary.search([], "a", (item) => item)
    expect(result.found).toBe(false)
    expect(result.index).toBe(0)
  })

  test("handles single element arrays", () => {
    const items = [{ id: "m" }]
    expect(Binary.search(items, "m", (item) => item.id)).toEqual({ found: true, index: 0 })
    expect(Binary.search(items, "a", (item) => item.id)).toEqual({ found: false, index: 0 })
    expect(Binary.search(items, "z", (item) => item.id)).toEqual({ found: false, index: 1 })
  })
})

describe("Binary.insert", () => {
  test("inserts into sorted array", () => {
    const items = ["a", "c", "f"].map((id) => ({ id }))
    Binary.insert(items, { id: "d" }, (item) => item.id)
    expect(items.map((item) => item.id)).toEqual(["a", "c", "d", "f"])
  })

  test("inserts at beginning and end", () => {
    const items = ["m"].map((id) => ({ id }))
    Binary.insert(items, { id: "a" }, (item) => item.id)
    Binary.insert(items, { id: "z" }, (item) => item.id)
    expect(items.map((item) => item.id)).toEqual(["a", "m", "z"])
  })
})
