package com.bquantum.bfastreader.data.local

import android.app.Application
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Application.dataStore: DataStore<Preferences> by preferencesDataStore(name = "credentials")

data class BiliCredential(
    val sessdata: String = "",
    val biliJct: String = "",
    val buvid3: String = "",
    val dedeuserId: String = "",
    val userName: String = "",
    val avatarUrl: String = ""
) {
    val isLoggedIn: Boolean get() = sessdata.isNotBlank()
    val csrf: String get() = biliJct
}

class CredentialStorage(private val app: Application) {

    val credential: Flow<BiliCredential> = app.dataStore.data.map { prefs ->
        BiliCredential(
            sessdata = prefs[KEY_SESSDATA] ?: "",
            biliJct = prefs[KEY_BILI_JCT] ?: "",
            buvid3 = prefs[KEY_BUVID3] ?: "",
            dedeuserId = prefs[KEY_DEDEUSERID] ?: "",
            userName = prefs[KEY_USERNAME] ?: "",
            avatarUrl = prefs[KEY_AVATAR] ?: ""
        )
    }

    suspend fun save(credential: BiliCredential) {
        app.dataStore.edit { prefs ->
            prefs[KEY_SESSDATA] = credential.sessdata
            prefs[KEY_BILI_JCT] = credential.biliJct
            prefs[KEY_BUVID3] = credential.buvid3
            prefs[KEY_DEDEUSERID] = credential.dedeuserId
            prefs[KEY_USERNAME] = credential.userName
            prefs[KEY_AVATAR] = credential.avatarUrl
        }
    }

    suspend fun clear() {
        app.dataStore.edit { it.clear() }
    }

    companion object {
        private val KEY_SESSDATA = stringPreferencesKey("sessdata")
        private val KEY_BILI_JCT = stringPreferencesKey("bili_jct")
        private val KEY_BUVID3 = stringPreferencesKey("buvid3")
        private val KEY_DEDEUSERID = stringPreferencesKey("dedeuserid")
        private val KEY_USERNAME = stringPreferencesKey("username")
        private val KEY_AVATAR = stringPreferencesKey("avatar")
    }
}
