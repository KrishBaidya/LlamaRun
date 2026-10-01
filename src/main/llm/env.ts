import { app } from 'electron'

export const is = {
  get dev(): boolean {
    return !app.isPackaged
  }
}
