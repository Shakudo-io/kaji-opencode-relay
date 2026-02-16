import { describe, expect, test } from "bun:test"
import { TypedEmitter } from "../src/events"

type EventMap = {
  ready: { at: number }
  message: { text: string }
}

describe("TypedEmitter", () => {
  test("emits to listeners", () => {
    const emitter = new TypedEmitter<EventMap>()
    const payloads: number[] = []

    emitter.on("ready", (payload) => {
      payloads.push(payload.at)
    })

    emitter.emit("ready", { at: 1 })
    emitter.emit("ready", { at: 2 })

    expect(payloads).toEqual([1, 2])
  })

  test("supports unsubscribe", () => {
    const emitter = new TypedEmitter<EventMap>()
    const received: string[] = []

    const unsubscribe = emitter.on("message", (payload) => {
      received.push(payload.text)
    })

    emitter.emit("message", { text: "first" })
    unsubscribe()
    emitter.emit("message", { text: "second" })

    expect(received).toEqual(["first"])
  })

  test("supports once listeners", () => {
    const emitter = new TypedEmitter<EventMap>()
    const received: string[] = []

    emitter.once("message", (payload) => {
      received.push(payload.text)
    })

    emitter.emit("message", { text: "first" })
    emitter.emit("message", { text: "second" })

    expect(received).toEqual(["first"])
  })

  test("supports multiple listeners", () => {
    const emitter = new TypedEmitter<EventMap>()
    const received: string[] = []

    emitter.on("message", (payload) => {
      received.push(`one:${payload.text}`)
    })
    emitter.on("message", (payload) => {
      received.push(`two:${payload.text}`)
    })

    emitter.emit("message", { text: "hello" })

    expect(received).toEqual(["one:hello", "two:hello"])
  })
})
