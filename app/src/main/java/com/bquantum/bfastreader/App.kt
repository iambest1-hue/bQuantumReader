package com.bquantum.bfastreader

import android.app.Application
import com.bquantum.bfastreader.di.appModule
import org.koin.core.context.startKoin

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        instance = this
        startKoin {
            modules(appModule)
        }
    }

    companion object {
        lateinit var instance: App
            private set
    }
}
