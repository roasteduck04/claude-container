package com.claudecontainers.android

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class ContainerStore(private val dir: File) {

    private val file: File get() = File(dir, "containers.json")
    private var counter = 0

    fun load(): MutableList<Container> {
        if (!file.exists()) return mutableListOf()
        return try {
            val arr = JSONArray(file.readText())
            val out = mutableListOf<Container>()
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                out.add(
                    Container(
                        id = o.getString("id"),
                        name = o.getString("name"),
                        color = o.getString("color"),
                    )
                )
            }
            out
        } catch (e: Exception) {
            mutableListOf()
        }
    }

    fun save(containers: List<Container>) {
        val arr = JSONArray()
        for (c in containers) {
            arr.put(
                JSONObject()
                    .put("id", c.id)
                    .put("name", c.name)
                    .put("color", c.color)
            )
        }
        writeAtomic(arr.toString())
    }

    fun add(name: String, color: String): Container {
        val c = Container(id = newId(), name = name, color = color)
        val list = load()
        list.add(c)
        save(list)
        return c
    }

    fun rename(id: String, name: String) {
        val list = load()
        val i = list.indexOfFirst { it.id == id }
        if (i >= 0) {
            list[i] = list[i].copy(name = name)
            save(list)
        }
    }

    fun remove(id: String) {
        val list = load()
        list.removeAll { it.id == id }
        save(list)
    }

    private fun newId(): String {
        counter += 1
        return "c${System.currentTimeMillis()}_$counter"
    }

    private fun writeAtomic(text: String) {
        if (!dir.exists()) dir.mkdirs()
        val tmp = File(dir, "containers.json.tmp")
        tmp.writeText(text)
        val target = file
        if (target.exists()) target.delete()
        tmp.renameTo(target)
    }
}
